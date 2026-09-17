"""Notebook-facing operations; no hidden training or evaluation subsets."""
from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from common import (generate_corrections, load_corrector, read_json, read_jsonl, release_gpu,
                    seed_everything, sha256_file, signature, write_json, write_jsonl)
from runtime import make_config, inspect_runtime, prepare_models, lock_recipe, portable_model_signature
from data_pipeline import prepare_data, generate_asr_cache, build_pairs
from evaluation import (apply_rules, build_rules, save_evaluation, run_ner_consistency,
                        export_review, bootstrap_comparison)
from training import train_seed, training_smoke


def tuning_records(records):
    result = [r for r in records if r["derived_split"] == "dev_tune"]
    if not result:
        raise ValueError("No dev_tune records")
    return result


def _prediction_identity(records):
    return [{key: record[key] for key in ("id", "reference_text", "hypothesis_text", "asr_signature")}
            for record in records]


def _validate_predictions(records, rows):
    indexed = {row["id"]: row for row in rows}
    if len(indexed) != len(rows) or set(indexed) != {r["id"] for r in records}:
        raise ValueError("Prediction cache IDs differ from evaluation records")
    for record in records:
        row = indexed[record["id"]]
        for key in ("reference_text", "hypothesis_text", "asr_signature"):
            if row.get(key) != record[key]:
                raise ValueError(f"Prediction cache source mismatch: {record['id']}")
        if not isinstance(row.get("prediction_text"), str) or not isinstance(row.get("preservation_text"), str):
            raise ValueError("Incomplete neural prediction/preservation cache")
    return ({identifier: row["prediction_text"] for identifier, row in indexed.items()},
            {identifier: row["preservation_text"] for identifier, row in indexed.items()})


def predict_neural(cfg, records, run_name, split_name, adapter_path=None, checkpoint=None):
    import torch
    model_signature = {"base": portable_model_signature(cfg)["correction"]}
    if adapter_path is not None:
        model_signature["adapter"] = {name: sha256_file(Path(adapter_path) / name)
                                      for name in ("adapter_config.json", "adapter_model.safetensors")}
    payload = {"model": model_signature, "generation": cfg["generation"], "precision": cfg["precision"],
               "max_source_tokens": cfg["max_source_tokens"], "identities": _prediction_identity(records),
               "common_sha256": sha256_file(Path(__file__).with_name("common.py")),
               "libraries": cfg["environment"]["libraries"], "mode": cfg["mode"]}
    key = signature(payload)
    directory = Path(cfg["outputs_dir"]) / "generation_cache" / key
    receipt_path = directory / "completed.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        rows_path = directory / "predictions.jsonl"
        if receipt["signature"] != key or sha256_file(rows_path) != receipt["predictions_sha256"]:
            raise RuntimeError("Neural prediction cache integrity failure")
        predictions, preservation = _validate_predictions(records, read_jsonl(rows_path))
        return predictions, preservation, receipt["measurements"]
    seed_everything(cfg["seed"])
    model, tokenizer = load_corrector(cfg, adapter_path)
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    predictions_text = generate_corrections(model, tokenizer, [r["hypothesis_text"] for r in records], cfg)
    preservation_text = generate_corrections(model, tokenizer, [r["reference_text"] for r in records], cfg)
    torch.cuda.synchronize()
    measurements = {"seconds": time.monotonic() - started, "peak_vram_bytes": torch.cuda.max_memory_allocated(),
                    "checkpoint": checkpoint or model_signature, "run_name": run_name, "split_name": split_name,
                    "num_inputs": len(records), "num_preservation_inputs": len(records)}
    rows = [{**record, "prediction_text": predicted, "preservation_text": preserved}
            for record, predicted, preserved in zip(records, predictions_text, preservation_text, strict=True)]
    write_jsonl(directory / "predictions.jsonl", rows)
    write_json(receipt_path, {"signature": key, "payload": payload, "complete": True,
                             "predictions_sha256": sha256_file(directory / "predictions.jsonl"), "measurements": measurements})
    del model, tokenizer
    release_gpu()
    predictions, preservation = _validate_predictions(records, rows)
    return predictions, preservation, measurements


def baselines(cfg, train_records, dev_records):
    rules = build_rules(cfg, train_records)
    export_review(cfg, dev_records, {})
    reports, predictions_by_run = {}, {}
    for name in ("R0", "R1"):
        started = time.monotonic()
        if name == "R0":
            predictions = {r["id"]: r["hypothesis_text"] for r in dev_records}
            preservation = {r["id"]: r["reference_text"] for r in dev_records}
        else:
            predictions = {r["id"]: apply_rules(r["hypothesis_text"], rules) for r in dev_records}
            preservation = {r["id"]: apply_rules(r["reference_text"], rules) for r in dev_records}
        reports[name] = save_evaluation(cfg, name, "dev_tune", dev_records, predictions, preservation,
                                       {"seconds": time.monotonic() - started, "peak_vram_bytes": 0,
                                        "rulebook_signature": signature(rules) if name == "R1" else None})
        predictions_by_run[name] = predictions
    predicted, preservation, measurements = predict_neural(cfg, dev_records, "R2", "dev_tune")
    reports["R2"] = save_evaluation(cfg, "R2", "dev_tune", dev_records, predicted, preservation, measurements)
    predictions_by_run["R2"] = predicted
    print(json.dumps({name: {"wer": r["summary"]["wer"], "preservation": r["summary"]["reference_overcorrection_rate"]}
                      for name, r in reports.items()}, indent=2), flush=True)
    return {"rules": rules, "reports": reports, "predictions": predictions_by_run}


def train_all(cfg, pairs, dev_records):
    lock_recipe(cfg, pairs, dev_records)
    receipts = [train_seed(cfg, pairs, dev_records, seed) for seed in cfg["seeds"]]
    if {receipt["seed"] for receipt in receipts} != set(cfg["seeds"]):
        raise RuntimeError("Missing declared training seed")
    write_json(Path(cfg["outputs_dir"]) / "training-runs.json", receipts)
    return receipts


def selected_dev_results(cfg, dev_records, receipts, baseline_result):
    reports = dict(baseline_result["reports"])
    predictions_by_run = dict(baseline_result["predictions"])
    for receipt in receipts:
        name = receipt["run_name"]
        epoch = receipt["best_key"][2]
        original = Path(cfg["outputs_dir"]) / "evaluation/dev_tune" / f"{name}_epoch{epoch}"
        manifest = read_json(original / "manifest.json")
        for filename, digest in manifest["files"].items():
            if sha256_file(original / filename) != digest:
                raise RuntimeError("Best checkpoint development prediction artifacts changed")
        predicted, preservation = _validate_predictions(dev_records, read_jsonl(original / "predictions.jsonl"))
        adapter_path = Path(cfg["models_dir"]) / cfg["mode"] / name / receipt["best_checkpoint"]
        measurements = {"seed": receipt["seed"], "checkpoint": str(adapter_path),
                        "checkpoint_hashes": receipt["best_hashes"], "optimizer_steps": receipt["actual_optimizer_steps"],
                        "training_seconds": receipt["training_seconds"], "peak_vram_bytes": receipt["peak_vram_bytes"]}
        reports[name] = save_evaluation(cfg, name, "dev_tune", dev_records, predicted, preservation, measurements)
        predictions_by_run[name] = predicted
    review = export_review(cfg, dev_records, predictions_by_run)
    ner = run_ner_consistency(cfg, dev_records, predictions_by_run, "dev_tune")
    stats = bootstrap_comparison(cfg, reports, "dev_tune")
    return {"reports": reports, "predictions": predictions_by_run, "review": review, "ner": ner,
            "statistics": stats, "rulebook_signature": baseline_result["rules"]["signature"]}


def lock_final_selection(cfg, receipts, dev_result):
    if len(receipts) != len(cfg["seeds"]) or any(r["mode"] != cfg["mode"] for r in receipts):
        raise ValueError("Incomplete or mixed-mode training receipts")
    candidate = min(receipts, key=lambda row: (*row["best_key"][:2], row["seed"]))
    selected = {"selected_run": candidate["run_name"], "seed": candidate["seed"],
                "checkpoint": candidate["best_checkpoint"], "checkpoint_hashes": candidate["best_hashes"],
                "recipe_signature": cfg["recipe_signature"], "mode": cfg["mode"],
                "all_runs": [{"run_name": r["run_name"], "best_checkpoint": r["best_checkpoint"],
                              "best_hashes": r["best_hashes"], "dev_key": r["best_key"]} for r in receipts],
                "selection_policy": cfg["selection_policy"],
                "rulebook_signature": dev_result["rulebook_signature"],
                "status": "trained_candidate_pending_human_review",
                "dev_relative_wer_reduction": dev_result["reports"][candidate["run_name"]]["summary"]["relative_wer_reduction"],
                "test_used_for_selection": False}
    signature_value = signature(selected)
    path = Path(cfg["outputs_dir"]) / "test-lock.json"
    if path.exists():
        existing = read_json(path)
        if existing["signature"] != signature_value:
            raise RuntimeError("Final selection changed after test lock")
        return existing
    selected["signature"] = signature_value
    selected["locked_at"] = datetime.now(timezone.utc).isoformat()
    write_json(path, selected)
    return selected


def _verify_test_lock(cfg, receipts, rules):
    lock = read_json(Path(cfg["outputs_dir"]) / "test-lock.json")
    body = {key: value for key, value in lock.items() if key not in {"signature", "locked_at"}}
    if signature(body) != lock["signature"] or lock["recipe_signature"] != cfg["recipe_signature"]:
        raise RuntimeError("Test lock integrity or recipe differs")
    actual = [{"run_name": r["run_name"], "best_checkpoint": r["best_checkpoint"],
               "best_hashes": r["best_hashes"], "dev_key": r["best_key"]} for r in receipts]
    if sorted(actual, key=lambda r: r["run_name"]) != sorted(lock["all_runs"], key=lambda r: r["run_name"]):
        raise RuntimeError("Test checkpoint matrix differs from the locked runs")
    if len({r["run_name"] for r in actual}) != len(cfg["seeds"]):
        raise RuntimeError("Duplicate or missing locked seed")
    if rules["signature"] != lock["rulebook_signature"]:
        raise RuntimeError("R1 rulebook differs from the test lock")
    if signature({key: value for key, value in rules.items() if key not in {"signature", "provenance"}}) != rules["signature"]:
        raise RuntimeError("Rulebook content changed after the train-only rule policy")
    for run in actual:
        directory = Path(cfg["models_dir"]) / cfg["mode"] / run["run_name"] / run["best_checkpoint"]
        for filename, digest in run["best_hashes"].items():
            if sha256_file(directory / filename) != digest:
                raise RuntimeError(f"Locked checkpoint content changed: {run['run_name']}/{filename}")
    return lock


def _fixed_matrix(cfg, records, receipts, rules, split_name, lock):
    predictions_by_run, reports = {}, {}
    for name in ("R0", "R1"):
        started = time.monotonic()
        predictions = {r["id"]: r["hypothesis_text"] if name == "R0" else apply_rules(r["hypothesis_text"], rules) for r in records}
        preservation = {r["id"]: r["reference_text"] if name == "R0" else apply_rules(r["reference_text"], rules) for r in records}
        reports[name] = save_evaluation(cfg, name, split_name, records, predictions, preservation,
                                       {"seconds": time.monotonic() - started, "peak_vram_bytes": 0,
                                        "test_lock_signature": lock["signature"]})
        predictions_by_run[name] = predictions
    runs = [("R2", None, None)]
    for receipt in receipts:
        adapter = Path(cfg["models_dir"]) / cfg["mode"] / receipt["run_name"] / receipt["best_checkpoint"]
        runs.append((receipt["run_name"], adapter, receipt))
    for name, adapter, receipt in runs:
        predictions, preservation, measurements = predict_neural(
            cfg, records, name, split_name, adapter, checkpoint=receipt or cfg["models"]["correction"])
        measurements = {**measurements, "test_lock_signature": lock["signature"],
                        "seed": receipt["seed"] if receipt else None}
        reports[name] = save_evaluation(cfg, name, split_name, records, predictions, preservation, measurements)
        predictions_by_run[name] = predictions
    ner = run_ner_consistency(cfg, records, predictions_by_run, split_name)
    statistics = bootstrap_comparison(cfg, reports, split_name)
    return {"records": records, "reports": reports, "predictions": predictions_by_run,
            "ner": ner, "statistics": statistics}


def final_evaluation(cfg, records_by_split, receipts, rules):
    lock = _verify_test_lock(cfg, receipts, rules)
    test = generate_asr_cache(cfg, records_by_split["test"], "test")
    if cfg["mode"] == "full" and len(test) != 3437:
        raise RuntimeError("Official test coverage incomplete")
    result = _fixed_matrix(cfg, test, receipts, rules, "test_official", lock)
    dev_all = generate_asr_cache(cfg, records_by_split["dev"], "dev")
    shared = [r for r in dev_all if r["derived_split"] == "dev_shared_recording"]
    cv = generate_asr_cache(cfg, records_by_split["cv"], "cv")
    result["diagnostics"] = {
        "dev_shared_recording": _fixed_matrix(cfg, shared, receipts, rules, "dev_shared_recording", lock),
        "cv_diagnostic": _fixed_matrix(cfg, cv, receipts, rules, "cv_diagnostic", lock),
    }
    write_json(Path(cfg["outputs_dir"]) / "diagnostic-summary.json", {
        "test_lock_signature": lock["signature"], "used_for_selection": False,
        "splits": {split: {run: report["summary"] for run, report in item["reports"].items()}
                   for split, item in result["diagnostics"].items()},
    })
    return result


def _fp32_merge_probe(model, tokenizer, texts, cfg, decoder_ids=None):
    """Control merge algebra independently of mixed-precision branch rounding."""
    import torch
    from common import normalize_text
    batch = tokenizer([normalize_text(text) for text in texts], padding=True,
                      truncation=False, return_tensors="pt").to(cfg["device"])
    if batch["input_ids"].shape[1] > cfg["max_source_tokens"]:
        raise ValueError("Fixed export probes exceed the declared input context")
    with torch.inference_mode(), torch.autocast("cuda", enabled=False):
        generated = model.generate(**batch, **cfg["generation"])
        prefixes = generated[:, :-1] if decoder_ids is None else decoder_ids.to(cfg["device"])
        logits = model(**batch, decoder_input_ids=prefixes, use_cache=False).logits.float().cpu()
    return tokenizer.batch_decode(generated, skip_special_tokens=True), prefixes.cpu(), logits


def _evaluate_exported_model(cfg, model, tokenizer, model_files, destination):
    """Measure the delivered weights, without choosing a new checkpoint from test."""
    import torch
    pointer = read_json(Path(cfg["derived_dir"]) / cfg["mode"] / "manifests/asr_test.json")
    if sha256_file(pointer["cache_path"]) != pointer["records_sha256"]:
        raise RuntimeError("Export verification test cache changed")
    records = read_jsonl(pointer["cache_path"])
    if cfg["mode"] == "full" and len(records) != 3437:
        raise RuntimeError("Export verification requires the entire official test")
    payload = {"files": model_files, "generation": cfg["generation"], "precision": cfg["precision"],
               "test_identities": _prediction_identity(records),
               "max_source_tokens": cfg["max_source_tokens"], "eval_batch_size": cfg["eval_batch_size"],
               "libraries": cfg["environment"]["libraries"], "device": cfg["device"], "mode": cfg["mode"],
               "common_sha256": sha256_file(Path(__file__).with_name("common.py"))}
    key = signature(payload)
    directory = Path(cfg["outputs_dir"]) / "exported_model_cache" / key
    receipt_path = directory / "completed.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if (receipt.get("complete") is not True or receipt["signature"] != key or
                sha256_file(directory / "predictions.jsonl") != receipt["predictions_sha256"]):
            raise RuntimeError("Exported-model prediction cache integrity failure")
        predictions, preservation = _validate_predictions(records, read_jsonl(directory / "predictions.jsonl"))
        measurements = receipt["measurements"]
    else:
        torch.cuda.reset_peak_memory_stats()
        started = time.monotonic()
        generated = generate_corrections(model, tokenizer, [r["hypothesis_text"] for r in records], cfg)
        preserved = generate_corrections(model, tokenizer, [r["reference_text"] for r in records], cfg)
        torch.cuda.synchronize()
        measurements = {"seconds": time.monotonic() - started, "peak_vram_bytes": torch.cuda.max_memory_allocated(),
                        "checkpoint": str(destination), "model_files": model_files,
                        "purpose": "serialization/merge verification; not a new model-selection run"}
        rows = [{**r, "prediction_text": prediction, "preservation_text": probe}
                for r, prediction, probe in zip(records, generated, preserved, strict=True)]
        write_jsonl(directory / "predictions.jsonl", rows)
        write_json(receipt_path, {"signature": key, "payload": payload, "complete": True, "measurements": measurements,
                                 "predictions_sha256": sha256_file(directory / "predictions.jsonl")})
        predictions, preservation = _validate_predictions(records, rows)
    selection = read_json(Path(cfg["outputs_dir"]) / "test-lock.json")
    adapter_rows = read_jsonl(Path(cfg["outputs_dir"]) / "evaluation/test_official" /
                             selection["selected_run"] / "predictions.jsonl")
    adapter_predictions, _ = _validate_predictions(records, adapter_rows)
    from common import normalize_for_scoring
    raw_differences = [r["id"] for r in records if predictions[r["id"]] != adapter_predictions[r["id"]]]
    content_differences = [r["id"] for r in records if normalize_for_scoring(predictions[r["id"]]) !=
                           normalize_for_scoring(adapter_predictions[r["id"]])]
    run_name = f"FinalModel_seed{selection['seed']}"
    report = save_evaluation(cfg, run_name, "test_official", records, predictions, preservation,
                             {**measurements, "seed": selection["seed"], "test_lock_signature": selection["signature"]})
    comparison = {"num_samples": len(records), "selected_adapter_run": selection["selected_run"],
                  "raw_differing_ids": raw_differences, "normalized_differing_ids": content_differences,
                  "test_used_to_reselect_model": False, "summary": report["summary"],
                  "predictions_path": report["predictions_path"]}
    write_json(Path(cfg["outputs_dir"]) / "exported-model-test.json", comparison)
    return comparison, records, {run_name: predictions}


def export_final_model(cfg, selection, train_records):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    selected_dir = Path(cfg["models_dir"]) / cfg["mode"] / selection["selected_run"] / selection["checkpoint"]
    for name, digest in selection["checkpoint_hashes"].items():
        if sha256_file(selected_dir / name) != digest:
            raise RuntimeError("Selected adapter changed after test lock")
    destination = Path(cfg["models_dir"]) / ("final_model" if cfg["mode"] == "full" else "smoke/final_model")
    probe_records = sorted(train_records, key=lambda row: row["id"])[:8]
    texts = [row["hypothesis_text"] for row in probe_records]
    seed_everything(42)
    model, tokenizer = load_corrector(cfg, selected_dir)
    adapter_predictions = generate_corrections(model, tokenizer, texts, cfg)
    fp32_before, decoder_ids, logits_before = _fp32_merge_probe(model, tokenizer, texts, cfg)
    model = model.merge_and_unload(safe_merge=True)
    fp32_after, _, logits_after = _fp32_merge_probe(model, tokenizer, texts, cfg, decoder_ids)
    torch.testing.assert_close(logits_before, logits_after, rtol=1e-4, atol=1e-3)
    if fp32_before != fp32_after:
        raise RuntimeError("FP32 merge control changed generated content")
    delta = (logits_before - logits_after).abs()
    precision_control = {"fp32_outputs_equal": True, "max_abs_logit_difference": float(delta.max()),
                         "mean_abs_logit_difference": float(delta.mean()), "atol": 1e-3, "rtol": 1e-4,
                         "explanation": "BF16 separately rounds base and LoRA branches; merged weights round after addition.",
                         "fp32_is_diagnostic_only": True, "deployment_precision_unchanged": cfg["precision"]}
    del decoder_ids, logits_before, logits_after, delta
    merged_predictions = generate_corrections(model, tokenizer, texts, cfg)
    model.config.use_cache = True
    model.generation_config.update(**cfg["generation"])
    model.save_pretrained(destination, safe_serialization=True)
    tokenizer.save_pretrained(destination)
    del model, tokenizer
    release_gpu()
    loaded = AutoModelForSeq2SeqLM.from_pretrained(destination, local_files_only=True,
                                                dtype=torch.float32, attn_implementation="sdpa").to(cfg["device"]).eval()
    loaded_tokenizer = AutoTokenizer.from_pretrained(destination, local_files_only=True)
    reloaded_predictions = generate_corrections(loaded, loaded_tokenizer, texts, cfg)
    if merged_predictions != reloaded_predictions:
        raise RuntimeError("Export/reload changes deterministic model outputs")
    differences = [probe_records[i]["id"] for i, (before, after) in enumerate(
        zip(adapter_predictions, merged_predictions, strict=True)) if before != after]
    comparison = {"adapter_vs_merged_equal": not differences, "differing_probe_ids": differences,
                  "merged_vs_reloaded_equal": True, "probe_count": len(texts), "precision_control": precision_control,
                  "inference_local_files_only": True, "reference_passed_to_inference": False}
    hashes = {path.name: sha256_file(path) for path in sorted(destination.iterdir())
              if path.is_file() and path.name != "export-manifest.json"}
    exported_test, test_records, exported_predictions = _evaluate_exported_model(
        cfg, loaded, loaded_tokenizer, hashes, destination)
    del loaded, loaded_tokenizer
    release_gpu()
    exported_ner = run_ner_consistency(cfg, test_records, exported_predictions, "exported_model_test")
    manifest = {"selection": selection, "source_model": portable_model_signature(cfg)["correction"],
                "recipe_signature": cfg["recipe_signature"], "generation": cfg["generation"],
                "inference": {"parameter_dtype": "float32", "precision": cfg["precision"],
                              "max_source_tokens": cfg["max_source_tokens"], "eval_batch_size": cfg["eval_batch_size"],
                              "attention_implementation": "sdpa",
                              "common_sha256": sha256_file(Path(__file__).with_name("common.py"))},
                "environment": cfg["environment"], "files": hashes, "verification": comparison,
                "exported_test_summary": exported_test["summary"], "exported_ner": exported_ner["runs"],
                "status": "trained_candidate_pending_human_review", "review_status": "not_human_adjudicated"}
    write_json(destination / "export-manifest.json", manifest)
    write_json(Path(cfg["outputs_dir"]) / "export-verification.json", {
        **comparison, "model_directory": str(destination),
        "exported_test_raw_differences": len(exported_test["raw_differing_ids"]),
        "exported_test_normalized_differences": len(exported_test["normalized_differing_ids"]),
        "demo": [{"id": row["id"], "asr_input": text, "corrected": prediction}
                 for row, text, prediction in zip(probe_records, texts, reloaded_predictions, strict=True)]})
    return {"model_directory": str(destination), "verification": comparison,
            "exported_test_summary": exported_test["summary"], "manifest": str(destination / "export-manifest.json")}


def final_summary(cfg, receipts, dev_result, test_result, export_result):
    rows = []
    for split, result in (("dev_tune", dev_result), ("test_official", test_result)):
        for run, report in result["reports"].items():
            summary = report["summary"]
            rows.append({"split": split, "run": run, "samples": summary["num_samples"], "wer": summary["wer"],
                         "cer": summary["cer"], "relative_wer_reduction": summary["relative_wer_reduction"],
                         "reference_overcorrection_rate": summary["reference_overcorrection_rate"],
                         "improved": summary["improved"], "worsened": summary["worsened"],
                         "ner_consistency_f1": result["ner"]["runs"][run]["consistency_f1"]})
    path = Path(cfg["outputs_dir"]) / "results.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    result = {"mode": cfg["mode"], "completed_runs": receipts, "metrics": rows, "export": export_result,
              "auxiliary": cfg["auxiliary"], "human_review": "pending; no clinical safety claim",
              "historical_test_exposure": True,
              "complete_full_training": cfg["mode"] == "full" and {r["seed"] for r in receipts} == {42, 43, 44},
              "recipe_signature": cfg["recipe_signature"],
              "test_lock": read_json(Path(cfg["outputs_dir"]) / "test-lock.json"),
              "notebook": str(Path(cfg["experiment_dir"]) / "train_correction_end_to_end.ipynb")}
    write_json(Path(cfg["outputs_dir"]) / "final-summary.json", result)
    print(json.dumps(rows, ensure_ascii=False, indent=2), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description="Run notebook operations with reusable verified artifacts")
    parser.add_argument("--mode", choices=["full", "smoke"], default="full")
    parser.add_argument("--stage", choices=["asr", "all"], default="all")
    args = parser.parse_args()
    cfg = make_config(mode=args.mode)
    inspect_runtime(cfg)
    print("Correction runtime ready", flush=True)
    prepare_models(cfg)
    records = prepare_data(cfg)
    train = generate_asr_cache(cfg, records["train"], "train")
    dev = tuning_records(generate_asr_cache(cfg, records["dev"], "dev"))
    if args.stage == "asr":
        print("Training/development ASR caches complete", flush=True)
        return
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(cfg["models"]["correction"]["path"], local_files_only=True)
    pairs = build_pairs(cfg, train, tokenizer)
    baseline = baselines(cfg, train, dev)
    training_smoke(cfg, pairs)
    receipts = train_all(cfg, pairs, dev)
    dev_result = selected_dev_results(cfg, dev, receipts, baseline)
    selection = lock_final_selection(cfg, receipts, dev_result)
    test_result = final_evaluation(cfg, records, receipts, baseline["rules"])
    export_result = export_final_model(cfg, selection, train)
    final_summary(cfg, receipts, dev_result, test_result, export_result)


if __name__ == "__main__":
    main()
