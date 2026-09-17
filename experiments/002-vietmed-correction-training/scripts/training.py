"""Deterministic seq2seq LoRA training with token-weighted accumulated loss."""
from __future__ import annotations

import hashlib
import math
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
from peft import LoraConfig, TaskType, get_peft_model
from transformers import DataCollatorForSeq2Seq, get_linear_schedule_with_warmup

from common import (autocast_context, generate_corrections, load_corrector, read_json,
                    release_gpu, seed_everything, sha256_file, signature, write_json)
from evaluation import evaluate_predictions, save_evaluation


def _adapter(cfg):
    model, tokenizer = load_corrector(cfg)
    recipe = cfg["training"]
    model = get_peft_model(model, LoraConfig(
        task_type=TaskType.SEQ_2_SEQ_LM, r=recipe["rank"], lora_alpha=recipe["alpha"],
        lora_dropout=recipe["dropout"], target_modules=["q_proj", "v_proj"], bias="none",
    ))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.config.use_cache = False
    trainable = {n: p for n, p in model.named_parameters() if p.requires_grad}
    if not trainable or any("lora_" not in name for name in trainable):
        raise RuntimeError("Unexpected trainable base weights")
    expected = 2359296
    count = sum(p.numel() for p in trainable.values())
    if recipe["rank"] == 16 and count != expected:
        raise RuntimeError(f"LoRA coverage differs from pinned architecture: {count} vs {expected}")
    return model, tokenizer


def _features(pairs, tokenizer, cfg):
    features = []
    for pair in pairs:
        source = tokenizer(pair["input_text"], truncation=False)
        labels = tokenizer(text_target=pair["target_text"], truncation=False)["input_ids"]
        if len(source["input_ids"]) > cfg["max_source_tokens"] or len(labels) > cfg["max_target_tokens"]:
            raise ValueError(f"Unaligned overlength pair {pair['pair_id']}")
        features.append({"input_ids": source["input_ids"], "attention_mask": source["attention_mask"],
                         "labels": labels})
    return features


def _epoch_indices(pairs, seed, epoch, fraction):
    errorful = [i for i, row in enumerate(pairs) if row["is_errorful"]]
    identity = [i for i, row in enumerate(pairs) if not row["is_errorful"]]
    if not errorful or not identity:
        raise ValueError("The declared errorful/identity sampler needs both populations")
    generator = np.random.default_rng(np.random.SeedSequence([seed, epoch, 271828]))
    count = len(pairs)
    errors = round(count * fraction)
    indices = np.concatenate([generator.choice(errorful, errors, replace=True),
                              generator.choice(identity, count - errors, replace=True)])
    generator.shuffle(indices)
    return indices.tolist()


def _parameter_hash(model, trainable):
    digest = hashlib.sha256()
    for name, parameter in model.named_parameters():
        if parameter.requires_grad == trainable:
            digest.update(name.encode())
            raw = parameter.detach().cpu().contiguous()
            digest.update(raw.view(torch.uint8).numpy().tobytes())
    return digest.hexdigest()


def _rng_state():
    return {"python": random.getstate(), "numpy": np.random.get_state(),
            "torch": torch.get_rng_state(), "cuda": torch.cuda.get_rng_state_all()}


def _restore_rng(state):
    random.setstate(state["python"])
    np.random.set_state(state["numpy"])
    torch.set_rng_state(state["torch"])
    torch.cuda.set_rng_state_all(state["cuda"])


def _artifact_hashes(directory):
    return {path.name: sha256_file(path) for path in sorted(Path(directory).iterdir())
            if path.is_file() and path.name in {"adapter_model.safetensors", "adapter_config.json", "state.pt"}}


def _verify_artifacts(directory, hashes):
    directory = Path(directory)
    if not hashes or any(not (directory / name).is_file() or sha256_file(directory / name) != value
                         for name, value in hashes.items()):
        raise RuntimeError(f"Checkpoint content verification failed: {directory}")


def _save_checkpoint(model, optimizer, scheduler, scaler, state, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(directory, safe_serialization=True)
    payload = {**state, "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(),
               "scaler": scaler.state_dict(), "rng": _rng_state()}
    temporary = directory / "state.pt.tmp"
    torch.save(payload, temporary)
    os.replace(temporary, directory / "state.pt")
    hashes = _artifact_hashes(directory)
    write_json(directory / "checkpoint.json", {"run_signature": state["run_signature"],
                                              "global_step": state["global_step"], "hashes": hashes})
    return hashes


def training_smoke(cfg, pairs):
    """A real independent two-update probe, never used as a full-run checkpoint."""
    seed_everything(42)
    destination = Path(cfg["models_dir"]) / cfg["mode"] / "smoke_adapter"
    model, tokenizer = _adapter(cfg)
    selected = [p for p in pairs if p["is_errorful"]][:4] + [p for p in pairs if not p["is_errorful"]][:4]
    if len(selected) < 2:
        raise ValueError("Insufficient mixed real/identity pairs for training smoke")
    collator = DataCollatorForSeq2Seq(tokenizer, model=model, label_pad_token_id=-100, return_tensors="pt")
    features = _features(selected, tokenizer, cfg)
    batch = collator(features).to(cfg["device"])
    if not torch.any(batch["labels"] == -100):
        # Equal target lengths are possible; verify collator behavior with an explicit shorter real target.
        short = dict(features[0], labels=features[0]["labels"][:1])
        padding_probe = collator([features[0], short])
        if len(features[0]["labels"]) > 1 and not torch.any(padding_probe["labels"] == -100):
            raise RuntimeError("Padding labels are not ignored")
    base_before = _parameter_hash(model, trainable=False)
    adapter_before = _parameter_hash(model, trainable=True)
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=cfg["training"]["learning_rate"])
    scaler = torch.amp.GradScaler("cuda", enabled=cfg["precision"] == "fp16")
    losses, gradient_norms = [], []
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    model.train()
    for _ in range(2):
        optimizer.zero_grad(set_to_none=True)
        with autocast_context(cfg):
            loss = model(**batch).loss
        if not torch.isfinite(loss):
            raise RuntimeError("Non-finite smoke training loss")
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        nonzero = sum(p.grad is not None and bool(torch.any(p.grad != 0))
                      for p in model.parameters() if p.requires_grad)
        if nonzero == 0 or any(p.grad is not None for p in model.parameters() if not p.requires_grad):
            raise RuntimeError("Adapter/base gradient invariant failed")
        norm = torch.nn.utils.clip_grad_norm_((p for p in model.parameters() if p.requires_grad), 1.0)
        if not torch.isfinite(norm):
            raise RuntimeError("Non-finite adapter gradient")
        scaler.step(optimizer)
        scaler.update()
        losses.append(float(loss.detach()))
        gradient_norms.append(float(norm))
    base_after = _parameter_hash(model, trainable=False)
    adapter_after = _parameter_hash(model, trainable=True)
    if base_before != base_after or adapter_before == adapter_after:
        raise RuntimeError("Frozen-base/updated-adapter hash invariant failed")
    model.save_pretrained(destination, safe_serialization=True)
    texts = [p["input_text"] for p in selected[:4]]
    before = generate_corrections(model, tokenizer, texts, cfg)
    measured = {"losses": losses, "gradient_norms": gradient_norms,
                "base_unchanged": True, "adapter_updated": True,
                "trainable_parameters": sum(p.numel() for p in model.parameters() if p.requires_grad),
                "peak_vram_bytes": torch.cuda.max_memory_allocated(),
                "seconds": time.monotonic() - started,
                "smoke_pair_ids": [p["pair_id"] for p in selected]}
    del loss, batch, model, optimizer, scaler, collator
    release_gpu()
    loaded, loaded_tokenizer = load_corrector(cfg, destination)
    after = generate_corrections(loaded, loaded_tokenizer, texts, cfg)
    if before != after:
        raise RuntimeError("Saved adapter changed deterministic generated outputs")
    measured["save_reload_outputs_equal"] = True
    measured["adapter_hashes"] = _artifact_hashes(destination)
    # Exercise the same metrics used for checkpoint selection on genuine train outputs.
    records = [{"id": p["pair_id"], "audio_name": "smoke_train_only", "reference_text": p["target_text"],
                "hypothesis_text": p["input_text"]} for p in selected[:4]]
    metrics = evaluate_predictions(records, {row["id"]: output for row, output in zip(records, after, strict=True)})
    measured["generated_smoke_metrics"] = metrics["summary"]
    write_json(Path(cfg["outputs_dir"]) / "training-smoke.json", measured)
    del loaded, loaded_tokenizer
    release_gpu()
    return measured


def _predict_dev(model, tokenizer, cfg, records):
    predictions = generate_corrections(model, tokenizer, [r["hypothesis_text"] for r in records], cfg)
    preservation = generate_corrections(model, tokenizer, [r["reference_text"] for r in records], cfg)
    return ({r["id"]: text for r, text in zip(records, predictions, strict=True)},
            {r["id"]: text for r, text in zip(records, preservation, strict=True)})


def train_seed(cfg, pairs, dev_records, seed):
    if any(row["split"] != "train" for row in pairs):
        raise ValueError("Training pairs contain held-out data")
    if any(row["derived_split"] != "dev_tune" for row in dev_records):
        raise ValueError("Checkpoint selection contains non-tuning records")
    if not cfg.get("recipe_signature"):
        raise RuntimeError("Lock the recipe before full R3 training")
    run_name = f"R3_seed{seed}"
    root = Path(cfg["models_dir"]) / cfg["mode"] / run_name
    root.mkdir(parents=True, exist_ok=True)
    run_signature = signature({"recipe": cfg["recipe_signature"], "seed": seed,
                               "training_code": sha256_file(__file__),
                               "common_code": sha256_file(Path(__file__).with_name("common.py"))})
    complete = root / "completed.json"
    if complete.exists():
        receipt = read_json(complete)
        if receipt["run_signature"] != run_signature:
            raise RuntimeError(f"Completed run signature mismatch: {run_name}")
        _verify_artifacts(root / receipt["best_checkpoint"], receipt["best_hashes"])
        if receipt["actual_optimizer_steps"] < 1 or receipt["completed_epochs"] < 1:
            raise RuntimeError("Invalid completed training receipt")
        print(f"Verified completed {run_name}: {receipt['actual_optimizer_steps']} updates", flush=True)
        return receipt
    seed_everything(seed)
    model, tokenizer = _adapter(cfg)
    recipe = cfg["training"]
    features = _features(pairs, tokenizer, cfg)
    collator = DataCollatorForSeq2Seq(tokenizer, model=model, label_pad_token_id=-100, return_tensors="pt")
    accumulation = recipe["gradient_accumulation_steps"]
    microbatch = recipe["batch_size"]
    updates_per_epoch = math.ceil(math.ceil(len(pairs) / microbatch) / accumulation)
    epochs = 1 if cfg["mode"] == "smoke" else recipe["epochs"]
    total_steps = updates_per_epoch * epochs
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],
                                 lr=recipe["learning_rate"], weight_decay=recipe["weight_decay"])
    scheduler = get_linear_schedule_with_warmup(optimizer, math.ceil(total_steps * recipe["warmup_ratio"]), total_steps)
    scaler = torch.amp.GradScaler("cuda", enabled=cfg["precision"] == "fp16")
    state = {"run_signature": run_signature, "epoch": 0, "next_group": 0, "global_step": 0,
             "history": [], "best_key": None, "best_checkpoint": None,
             "bad_epochs": 0, "training_seconds": 0.0, "epoch_loss_sum": 0.0, "epoch_tokens": 0,
             "peak_vram_bytes": 0}
    latest_pointer = root / "latest.json"
    if latest_pointer.exists():
        pointer = read_json(latest_pointer)
        _verify_artifacts(root / pointer["directory"], pointer["hashes"])
        loaded_state = torch.load(root / pointer["directory"] / "state.pt", map_location="cpu", weights_only=False)
        if loaded_state["run_signature"] != run_signature:
            raise RuntimeError("Resume signature differs from current run")
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file
        set_peft_model_state_dict(model, load_file(str(root / pointer["directory"] / "adapter_model.safetensors")))
        optimizer.load_state_dict(loaded_state.pop("optimizer"))
        scheduler.load_state_dict(loaded_state.pop("scheduler"))
        scaler.load_state_dict(loaded_state.pop("scaler"))
        rng = loaded_state.pop("rng")
        state = loaded_state
        _restore_rng(rng)
        print(f"Resuming {run_name}: epoch={state['epoch']}, group={state['next_group']}", flush=True)
    torch.cuda.reset_peak_memory_stats()
    session_started = time.monotonic()
    previous_seconds = state["training_seconds"]

    def checkpoint():
        state["training_seconds"] = previous_seconds + time.monotonic() - session_started
        state["peak_vram_bytes"] = max(state["peak_vram_bytes"], torch.cuda.max_memory_allocated())
        # Alternate slots so an interrupted write cannot corrupt the last committed resume pointer.
        slot = f"resume-{state['global_step'] % 2}-{state['epoch'] % 2}"
        pointer_old = read_json(latest_pointer) if latest_pointer.exists() else None
        if pointer_old and pointer_old["directory"] == slot:
            slot += "-alternate"
        hashes = _save_checkpoint(model, optimizer, scheduler, scaler, state, root / slot)
        write_json(latest_pointer, {"directory": slot, "hashes": hashes})

    while state["epoch"] < epochs and state["bad_epochs"] < recipe["patience"]:
        epoch = state["epoch"]
        indices = _epoch_indices(pairs, seed, epoch, recipe["errorful_fraction"])
        batches = [indices[i:i + microbatch] for i in range(0, len(indices), microbatch)]
        model.train()
        for group_start in range(state["next_group"], len(batches), accumulation):
            group = batches[group_start:group_start + accumulation]
            tokens = sum(len(features[index]["labels"]) for ids in group for index in ids)
            if tokens == 0:
                raise RuntimeError("Empty supervision group")
            optimizer.zero_grad(set_to_none=True)
            group_loss = 0.0
            for ids in group:
                batch = collator([dict(features[index]) for index in ids]).to(cfg["device"])
                batch_tokens = int((batch["labels"] != -100).sum())
                with autocast_context(cfg):
                    output = model(**batch)
                    weighted_loss = output.loss * (batch_tokens / tokens)
                if not torch.isfinite(weighted_loss):
                    raise RuntimeError(f"Non-finite loss in {run_name}, epoch {epoch}")
                scaler.scale(weighted_loss).backward()
                group_loss += float(output.loss.detach()) * batch_tokens
                del output, weighted_loss, batch
            scaler.unscale_(optimizer)
            gradient_norm = torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], recipe["max_grad_norm"])
            if not torch.isfinite(gradient_norm):
                raise RuntimeError("Non-finite training gradient; no update was accepted")
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            state["global_step"] += 1
            state["next_group"] = group_start + len(group)
            state["epoch_loss_sum"] += group_loss
            state["epoch_tokens"] += tokens
            if state["global_step"] % 25 == 0:
                print(f"{run_name} epoch={epoch + 1} step={state['global_step']}/{total_steps} loss={group_loss/tokens:.4f}", flush=True)
            if state["global_step"] % 50 == 0:
                checkpoint()
        checkpoint()
        destination = root / f"epoch-{epoch + 1}"
        model.save_pretrained(destination, safe_serialization=True)
        evaluation_started = time.monotonic()
        predictions, preservation = _predict_dev(model, tokenizer, cfg, dev_records)
        report = save_evaluation(
            cfg, f"{run_name}_epoch{epoch + 1}", "dev_tune", dev_records, predictions, preservation,
            {"seed": seed, "checkpoint": str(destination), "checkpoint_hashes": _artifact_hashes(destination),
             "optimizer_steps": state["global_step"], "seconds": time.monotonic() - evaluation_started,
             "peak_vram_bytes": torch.cuda.max_memory_allocated()},
        )
        summary = report["summary"]
        wer = summary.get("wer", summary.get("corpus_wer"))
        preservation_rate = summary.get("reference_overcorrection_rate")
        if preservation_rate is None:
            preservation_rate = summary.get("preservation", {}).get("reference_overcorrection_rate", 0.0)
        if wer is None:
            raise RuntimeError("Development corpus WER is undefined")
        key = [wer, preservation_rate, epoch + 1]
        entry = {"epoch": epoch + 1, "optimizer_steps": state["global_step"],
                 "token_cross_entropy": state["epoch_loss_sum"] / state["epoch_tokens"],
                 "dev_wer": wer, "reference_overcorrection_rate": preservation_rate}
        state["history"].append(entry)
        if state["best_key"] is None or key < state["best_key"]:
            state["best_key"] = key
            state["best_checkpoint"] = destination.name
            state["bad_epochs"] = 0
        else:
            state["bad_epochs"] += 1
        print(f"{run_name} epoch {epoch + 1}: dev WER={wer:.6f}, preservation changes={preservation_rate:.6f}", flush=True)
        state["epoch"] += 1
        state["next_group"] = 0
        state["epoch_loss_sum"] = 0.0
        state["epoch_tokens"] = 0
        checkpoint()
        write_json(root / "history.json", state["history"])
    receipt = {"run_name": run_name, "seed": seed, "mode": cfg["mode"], "run_signature": run_signature,
               "recipe_signature": cfg["recipe_signature"], "actual_optimizer_steps": state["global_step"],
               "maximum_optimizer_steps": total_steps, "completed_epochs": state["epoch"],
               "stopping_reason": "early_stopping" if state["bad_epochs"] >= recipe["patience"] else "maximum_epochs",
               "best_checkpoint": state["best_checkpoint"], "best_key": state["best_key"],
               "best_hashes": _artifact_hashes(root / state["best_checkpoint"]),
               "history": state["history"], "training_seconds": state["training_seconds"],
               "peak_vram_bytes": state["peak_vram_bytes"], "pair_count": len(pairs),
               "sampler_draws_per_epoch": len(pairs), "identity_fraction": 1 - recipe["errorful_fraction"],
               "loss_weighting": "non-padding target tokens within each accumulated optimizer update"}
    write_json(complete, receipt)
    del model, tokenizer, optimizer, scheduler, scaler, collator
    release_gpu()
    return receipt
