import argparse
import gc
import json
import os
import statistics
import time
from pathlib import Path

import numpy as np
import torch
from datasets import Dataset, load_dataset
from seqeval.metrics import classification_report, f1_score
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    DataCollatorForTokenClassification,
    Trainer,
    TrainingArguments,
    set_seed,
)

from preprocessing import encode_words, normalize_row, prepare_vi_ner, sentence_key

ROOT = Path(__file__).resolve().parent
MODELS = {"phobert": ("vinai/phobert-base-v2", 0.05),
          "vihealthbert": ("demdecuong/vihealthbert-base-syllable", 0.01)}
SEEDS = (42, 123, 2024)


def save_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def tag_names(split, column):
    feature = split.features[column].feature
    if hasattr(feature, "names"):
        return list(feature.names)
    return sorted({str(tag) for row in split for tag in row[column]})


def prepare_vietmed(raw):
    raw = {split: raw[split].select_columns(["words", "labels"])
           for split in ("train", "validation", "test")}
    feature = raw["train"].features["labels"].feature
    names = list(dict.fromkeys("O" if name == "0" else name
                               for name in tag_names(raw["train"], "labels")))
    result = {}
    for split in ("train", "validation", "test"):
        result[split] = [{"words": row["words"],
                          "tags": ["O" if str(tag) == "0" else
                                   feature.int2str(tag) if isinstance(tag, int) else str(tag)
                                   for tag in row["labels"]]}
                         for row in raw[split]]
    return result, names


def tokenize(rows, tokenizer, names):
    label2id = {name: i for i, name in enumerate(names)}
    encoded = [encode_words(row["words"], row["tags"], tokenizer, label2id)[0]
               for row in rows]
    return Dataset.from_list(encoded)


def labels_from_predictions(predictions, labels, names):
    ids = np.argmax(predictions, axis=-1)
    predicted, gold = [], []
    for prediction, truth in zip(ids, labels):
        keep = truth != -100
        predicted.append([names[int(i)] for i in prediction[keep]])
        gold.append([names[int(i)] for i in truth[keep]])
    return predicted, gold


def trainer_for(model, tokenizer, train_data, val_data, names, output_dir, seed, wd, epochs):
    def metrics(eval_pred):
        pred, gold = labels_from_predictions(eval_pred.predictions, eval_pred.label_ids, names)
        return {"f1": float(f1_score(gold, pred, zero_division=0))}

    args = TrainingArguments(
        output_dir=str(output_dir), learning_rate=3e-5,
        per_device_train_batch_size=4, per_device_eval_batch_size=8,
        gradient_accumulation_steps=4, num_train_epochs=epochs,
        weight_decay=wd, lr_scheduler_type="linear", warmup_ratio=0.1,
        eval_strategy="epoch", save_strategy="epoch", save_total_limit=1,
        load_best_model_at_end=True, metric_for_best_model="f1",
        greater_is_better=True, logging_steps=100, seed=seed,
        bf16=True, report_to="none", dataloader_num_workers=0,
    )
    return Trainer(model=model, args=args, train_dataset=train_data,
                   eval_dataset=val_data,
                   data_collator=DataCollatorForTokenClassification(tokenizer),
                   processing_class=tokenizer, compute_metrics=metrics)


def run_one(kind, seed, model_id, wd, vm, vm_names, vn, vn_names, tokenizer, work):
    set_seed(seed)
    torch.cuda.reset_peak_memory_stats()
    start = time.monotonic()
    vm_data = {split: tokenize(rows, tokenizer, vm_names) for split, rows in vm.items()}
    result = {"condition": kind, "seed": seed, "model": model_id,
              "outside_tag": "O",
              "hyperparameters": {"learning_rate": 3e-5, "epochs": 8,
                                    "weight_decay": wd, "warmup_ratio": 0.1,
                                    "effective_batch_size": 16, "precision": "bf16"}}
    if kind == "intermediate":
        vn_data = {split: tokenize(rows, tokenizer, vn_names) for split, rows in vn.items()}
        stage1 = AutoModelForTokenClassification.from_pretrained(
            model_id, num_labels=len(vn_names),
            id2label=dict(enumerate(vn_names)),
            label2id={name: i for i, name in enumerate(vn_names)})
        first = trainer_for(stage1, tokenizer, vn_data["train"], vn_data["validation"],
                            vn_names, work / "stage1", seed, wd, 8)
        first.train()
        result["stage1_validation_f1"] = float(first.evaluate()["eval_f1"])
        encoder_weights = {k: v.detach().cpu().clone()
                           for k, v in first.model.base_model.state_dict().items()}
        del first, stage1
        gc.collect()
        torch.cuda.empty_cache()
    set_seed(seed)
    model = AutoModelForTokenClassification.from_pretrained(
        model_id, num_labels=len(vm_names), id2label=dict(enumerate(vm_names)),
        label2id={name: i for i, name in enumerate(vm_names)})
    if kind == "intermediate":
        model.base_model.load_state_dict(encoder_weights)
        del encoder_weights
    second = trainer_for(model, tokenizer, vm_data["train"], vm_data["validation"],
                         vm_names, work / "stage2", seed, wd, 8)
    second.train()
    result["validation_f1"] = float(second.evaluate()["eval_f1"])
    output = second.predict(vm_data["test"])
    pred, gold = labels_from_predictions(output.predictions, output.label_ids, vm_names)
    report = classification_report(gold, pred, output_dict=True, zero_division=0)
    types = [name[2:] for name in vm_names if name.startswith("B-")]
    result["test"] = {
        "micro_f1": float(f1_score(gold, pred, zero_division=0)),
        "macro_f1": float(statistics.mean(report.get(t, {}).get("f1-score", 0.0)
                                           for t in types)),
        "per_type": {t: {"precision": float(report.get(t, {}).get("precision", 0.0)),
                         "recall": float(report.get(t, {}).get("recall", 0.0)),
                         "f1": float(report.get(t, {}).get("f1-score", 0.0)),
                         "support": int(report.get(t, {}).get("support", 0))}
                     for t in types},
    }
    result["gpu_seconds"] = round(time.monotonic() - start, 2)
    result["peak_vram_gb"] = round(torch.cuda.max_memory_allocated() / 1024**3, 3)
    del second, model
    gc.collect()
    torch.cuda.empty_cache()
    return result


def aggregate(results):
    summary = {}
    for condition in ("baseline", "intermediate"):
        rows = [r for r in results if r["condition"] == condition]
        if not rows:
            continue
        def stats(values):
            return {"mean": statistics.mean(values),
                    "std": statistics.stdev(values) if len(values) > 1 else 0.0}
        summary[condition] = {
            "n": len(rows),
            "micro_f1": stats([r["test"]["micro_f1"] for r in rows]),
            "macro_f1": stats([r["test"]["macro_f1"] for r in rows]),
            "per_type": {t: {metric: stats([r["test"]["per_type"][t][metric]
                                          for r in rows])
                             for metric in ("precision", "recall", "f1")}
                         for t in rows[0]["test"]["per_type"]},
        }
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", choices=MODELS, default="phobert")
    parser.add_argument("--seeds", type=int, nargs="+", default=list(SEEDS))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; refusing CPU training")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    model_id, wd = MODELS[args.encoder]
    out = ROOT / "results" / args.encoder
    work = ROOT / ".local" / args.encoder
    work.mkdir(parents=True, exist_ok=True)
    vm, vm_names = prepare_vietmed(load_dataset("leduckhai/VietMed-NER"))
    heldout = {sentence_key(normalize_row(r["words"], r["tags"])["words"])
               for split in ("validation", "test") for r in vm[split]}
    vn, log = prepare_vi_ner(load_dataset("Minggz/Vi-Ner"), heldout)
    vn_names = ["O"] + [f"{prefix}-{kind}" for kind in
                         ("PERSON", "LOCATION", "ORGANIZATION", "DATETIME")
                         for prefix in ("B", "I")]
    save_json(ROOT / "results" / "preprocessing.json", log)
    tokenizer = AutoTokenizer.from_pretrained(model_id, use_fast=True)
    completed = []
    for seed in args.seeds:
        for condition in ("baseline", "intermediate"):
            path = out / f"{condition}-seed-{seed}.json"
            if path.exists() and not args.force:
                existing = json.loads(path.read_text())
                if existing.get("outside_tag") != "O":
                    raise ValueError(f"Stale scoring in {path}; rerun with --force")
                completed.append(existing)
                continue
            run_dir = f"corrected-{condition}-{seed}" if args.force else f"{condition}-{seed}"
            result = run_one(condition, seed, model_id, wd, vm, vm_names, vn,
                             vn_names, tokenizer, work / run_dir)
            save_json(path, result)
            completed.append(result)
            print(f"{condition} seed {seed}: test F1={result['test']['micro_f1']:.4f}", flush=True)
    save_json(out / "aggregate.json", {"encoder": args.encoder,
              "seeds": args.seeds, "summary": aggregate(completed),
              "total_gpu_seconds": sum(r["gpu_seconds"] for r in completed),
              "peak_vram_gb": max(r["peak_vram_gb"] for r in completed)})


if __name__ == "__main__":
    main()
