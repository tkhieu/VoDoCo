"""Train-only rules and auditable evaluation; no clinical or gold-NER claims."""
from __future__ import annotations

import csv
import math
import random
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from common import (
    normalize_for_scoring, normalize_text, read_json, release_gpu,
    sha256_file, signature, write_json, write_jsonl,
)

_VERSION = "correction-evaluation-v1"
_BACKGROUND = {"0", "o", "dum"}
_NEGATIONS = {"không", "chưa", "chẳng", "chả", "đừng", "phủ", "no", "not", "without"}
_UNITS = {"mg", "g", "kg", "mcg", "µg", "ml", "l", "mmol", "mol", "iu", "ui", "mmhg", "cm", "mm", "%"}
_WORD = re.compile(r"\w+", re.UNICODE)
_POLICY = {
    "normalization": "experiment001 NFC/lower/non-word-to-space/collapse-whitespace",
    "word_unit": "whitespace-delimited units, usually Vietnamese syllables",
    "character_unit": "Unicode codepoints including normalized interword spaces",
    "zero_denominator": "null, including empty-empty; numerator counts always retained",
    "sentence_summary": "mean/median over nonempty normalized references only",
    "delta": "candidate minus raw; negative is improvement",
}


def _ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def _index(records):
    indexed = {}
    for record in records:
        identifier = record["id"]
        if not isinstance(identifier, str) or not identifier or identifier in indexed:
            raise ValueError(f"Missing/duplicate/invalid record ID: {identifier!r}")
        for field in ("reference_text", "hypothesis_text", "audio_name"):
            if not isinstance(record[field], str):
                raise TypeError(f"{identifier}: {field} must be a string")
        if not record["audio_name"]:
            raise ValueError(f"{identifier}: empty recording cluster")
        indexed[identifier] = record
    return indexed


def _join(indexed, predictions, name="predictions"):
    if not isinstance(predictions, dict):
        raise TypeError(f"{name} must be an exact ID-to-string dictionary")
    missing, extra = set(indexed) - set(predictions), set(predictions) - set(indexed)
    if missing or extra:
        raise ValueError(f"{name} coverage mismatch: missing={sorted(missing)}, extra={sorted(extra)}")
    if any(not isinstance(text, str) for text in predictions.values()):
        raise TypeError(f"{name} contains a non-string prediction")


def _opcodes(reference, hypothesis):
    from rapidfuzz.distance import Levenshtein
    return Levenshtein.opcodes(reference, hypothesis)


def _counts(reference, hypothesis):
    counts = {"substitutions": 0, "deletions": 0, "insertions": 0, "hits": 0}
    for tag, i, j, k, l in _opcodes(reference, hypothesis):
        a, b = j - i, l - k
        if tag == "equal":
            counts["hits"] += a
        else:
            substitutions = min(a, b)
            counts["substitutions"] += substitutions
            counts["deletions"] += a - substitutions
            counts["insertions"] += b - substitutions
    counts["errors"] = sum(counts[key] for key in ("substitutions", "deletions", "insertions"))
    return counts


def _text_metrics(reference, hypothesis):
    words = _counts(reference.split(), hypothesis.split())
    characters = _counts(reference, hypothesis)
    return {
        **words, "reference_words": len(reference.split()), "reference_characters": len(reference),
        "wer": _ratio(words["errors"], len(reference.split())),
        "cer": _ratio(characters["errors"], len(reference)),
        **{f"character_{key}": value for key, value in characters.items()},
    }


def _aggregate(rows):
    count_keys = ("reference_words", "reference_characters", "substitutions", "deletions", "insertions", "hits", "errors",
                  "character_substitutions", "character_deletions", "character_insertions", "character_hits", "character_errors")
    totals = {key: sum(row[key] for row in rows) for key in count_keys}
    sentence_wers = [row["wer"] for row in rows if row["wer"] is not None]
    sentence_cers = [row["cer"] for row in rows if row["cer"] is not None]
    return {
        **totals, "num_samples": len(rows),
        "wer": _ratio(totals["errors"], totals["reference_words"]),
        "cer": _ratio(totals["character_errors"], totals["reference_characters"]),
        "corpus_wer": _ratio(totals["errors"], totals["reference_words"]),
        "corpus_cer": _ratio(totals["character_errors"], totals["reference_characters"]),
        "mean_sentence_wer": statistics.mean(sentence_wers) if sentence_wers else None,
        "median_sentence_wer": statistics.median(sentence_wers) if sentence_wers else None,
        "mean_sentence_cer": statistics.mean(sentence_cers) if sentence_cers else None,
        "median_sentence_cer": statistics.median(sentence_cers) if sentence_cers else None,
        "undefined_sentence_wer": len(rows) - len(sentence_wers),
        "undefined_sentence_cer": len(rows) - len(sentence_cers),
        "empty_reference_samples": sum(row["reference_words"] == 0 for row in rows),
        "insertions_on_empty_references": sum(row["insertions"] for row in rows if not row["reference_words"]),
        "character_insertions_on_empty_references": sum(row["character_insertions"] for row in rows if not row["reference_characters"]),
    }


def _comparison_summary(rows):
    summary = _aggregate(rows)
    raw_rows = [{key.removeprefix("raw_"): value for key, value in row.items() if key.startswith("raw_")} for row in rows]
    raw = _aggregate(raw_rows)
    summary["raw"] = raw
    for metric in ("wer", "cer"):
        summary[f"raw_{metric}"] = raw[metric]
        summary[f"delta_{metric}"] = None if summary[metric] is None or raw[metric] is None else summary[metric] - raw[metric]
    summary["relative_wer_reduction"] = _ratio(raw["errors"] - summary["errors"], raw["errors"]) if summary["reference_words"] else None
    for category in ("improved", "worsened", "tied"):
        summary[category] = sum(row["comparison"] == category for row in rows)
    for kind in ("raw_string", "normalized_string"):
        count = sum(row["changes"][kind] for row in rows)
        summary[f"{kind}_changed"] = count
        summary[f"{kind}_change_rate"] = _ratio(count, len(rows))
    initially_correct = [row for row in rows if row["raw_errors"] == 0]
    summary["initially_correct_samples"] = len(initially_correct)
    summary["initially_correct_worsened"] = sum(row["errors"] > 0 for row in initially_correct)
    summary["initially_correct_worsening_rate"] = _ratio(summary["initially_correct_worsened"], len(initially_correct))
    preservation_rows = [row["preservation"] for row in rows if row["preservation"] is not None]
    preservation = _aggregate(preservation_rows)
    preservation["status"] = "evaluated" if preservation_rows else "not_evaluated"
    for kind in ("raw_string", "normalized_string"):
        count = sum(row[f"{kind}_changed"] for row in preservation_rows)
        preservation[f"{kind}_changed"] = count
        preservation[f"{kind}_change_rate"] = _ratio(count, len(preservation_rows))
    preservation["reference_overcorrection_rate"] = preservation["normalized_string_change_rate"]
    summary["preservation"] = preservation
    summary["reference_overcorrection_rate"] = preservation["reference_overcorrection_rate"]
    return summary


def evaluate_predictions(records, predictions, preservation=None):
    """Score exact joins; never drop empty references or legitimate empty outputs."""
    indexed = _index(records)
    _join(indexed, predictions)
    if preservation is not None:
        _join(indexed, preservation, "preservation")
    rows = []
    for identifier, record in indexed.items():
        reference = normalize_for_scoring(record["reference_text"])
        raw = normalize_for_scoring(record["hypothesis_text"])
        candidate = normalize_for_scoring(predictions[identifier])
        corrected_metrics, raw_metrics = _text_metrics(reference, candidate), _text_metrics(reference, raw)
        probe = None
        if preservation is not None:
            normalized_probe = normalize_for_scoring(preservation[identifier])
            probe = {
                **_text_metrics(reference, normalized_probe),
                "raw_string_changed": preservation[identifier] != record["reference_text"],
                "normalized_string_changed": normalized_probe != reference,
            }
        error_delta = corrected_metrics["errors"] - raw_metrics["errors"]
        changes = {"raw_string": predictions[identifier] != record["hypothesis_text"], "normalized_string": candidate != raw}
        rows.append({
            "id": identifier, "audio_name": record["audio_name"],
            "reference_text": record["reference_text"], "hypothesis_text": record["hypothesis_text"],
            "prediction_text": predictions[identifier], "preservation_text": preservation[identifier] if preservation is not None else None,
            **corrected_metrics, **{f"raw_{key}": value for key, value in raw_metrics.items()},
            "delta_errors": error_delta,
            "delta_wer": _ratio(error_delta, corrected_metrics["reference_words"]),
            "delta_cer": _ratio(corrected_metrics["character_errors"] - raw_metrics["character_errors"], corrected_metrics["reference_characters"]),
            "comparison": "improved" if error_delta < 0 else "worsened" if error_delta > 0 else "tied",
            "changes": changes, "preservation": probe,
        })
    summary = _comparison_summary(rows)
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["audio_name"]].append(row)
    summary["per_recording"] = {name: _comparison_summary(group) for name, group in sorted(grouped.items())}
    summary["metric_policy"] = dict(_POLICY)
    return {"summary": summary, "per_sample": rows}


def _component(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name) or ".." in name:
        raise ValueError(f"Unsafe artifact name: {name!r}")
    return name


def _provenance(cfg):
    return {"version": _VERSION, "code_sha256": sha256_file(Path(__file__)),
            "common_code_sha256": sha256_file(Path(__file__).with_name("common.py")),
            "scoring_code_sha256": sha256_file(Path(cfg["root"]) / "experiments/001-zeroshot-correction-vietmed/scripts/text-normalization-utils.py"),
            "mode": cfg["mode"], "source": cfg["source"], "models": cfg["models"],
            "environment": cfg.get("environment", {}), "generation": cfg.get("generation", {}),
            "training": cfg.get("training", {}), "seeds": cfg.get("seeds", []), "metric_policy": _POLICY}


def _manifest(directory, payload, files):
    manifest = {**payload, "files": {Path(path).name: sha256_file(path) for path in files}}
    manifest["signature"] = signature(manifest)
    path = Path(directory) / "manifest.json"
    write_json(path, manifest)
    return path, manifest["signature"]


def save_evaluation(cfg, run_name, split_name, records, predictions, preservation, measurements=None):
    report = evaluate_predictions(records, predictions, preservation)
    directory = Path(cfg["outputs_dir"]) / "evaluation" / _component(split_name) / _component(run_name)
    rows = []
    measurements = measurements or {}
    seed_match = re.fullmatch(r"R3[-_](?:seed[-_]?)?(42|43|44)", run_name, re.IGNORECASE)
    run_seed = measurements.get("seed", int(seed_match.group(1)) if seed_match else None)
    checkpoint = measurements.get("checkpoint", measurements.get("adapter_path"))
    if checkpoint is None and run_name == "R2":
        checkpoint = cfg["models"]["correction"]
    for record, scored in zip(records, report["per_sample"]):
        rows.append({**record, **scored, "run_name": run_name, "seed": run_seed, "checkpoint": checkpoint})
    predictions_path, summary_path = directory / "predictions.jsonl", directory / "summary.json"
    write_jsonl(predictions_path, rows)
    write_json(summary_path, {**report["summary"], "measurements": measurements})
    manifest_path, artifact_signature = _manifest(directory, {
        **_provenance(cfg), "run_name": run_name, "split_name": split_name,
        "records_signature": signature(sorted(records, key=lambda row: row["id"])),
        "predictions_signature": signature(predictions), "preservation_signature": signature(preservation),
        "measurements": measurements,
    }, [predictions_path, summary_path])
    return {**report, "manifest_path": str(manifest_path), "signature": artifact_signature,
            "predictions_path": str(predictions_path), "summary_path": str(summary_path)}


def _protected(tokens):
    return any(any(character.isdigit() for character in token) or token in _NEGATIONS or token in _UNITS for token in tokens)


def build_rules(cfg, train_records):
    """Mine recurrent substitutions, accepting only strong train evidence.

    Contextual rules need two independent utterances and unanimous support;
    context-free rules need three and >=98% support, with the source absent
    from the train-reference lexicon. Numbers, units and negations are protected.
    No insertions/deletions, cascading rewrites, or held-out lexicon are used.
    """
    indexed = _index(train_records)
    if any(record["split"] != "train" or not identifier.startswith("train:") for identifier, record in indexed.items()):
        raise ValueError("R1 learning accepts original train records only")
    usable = [record for record in indexed.values() if not record.get("duplicate_excluded", False)]
    if any(record["source_revision"] != cfg["source"]["revision"] for record in usable):
        raise ValueError("Rule training source revision mismatch")
    asr_signatures = {record["asr_signature"] for record in usable}
    if len(asr_signatures) > 1 or any(not value for value in asr_signatures):
        raise ValueError("R1 learning requires one nonempty pinned ASR signature")
    examples, occurrences, reference_vocabulary = defaultdict(list), defaultdict(list), Counter()
    for record in sorted(usable, key=lambda row: row["id"]):
        ref = normalize_for_scoring(record["reference_text"]).split()
        hyp = normalize_for_scoring(record["hypothesis_text"]).split()
        reference_vocabulary.update(ref)
        aligned = {}
        for tag, i, j, k, l in _opcodes(ref, hyp):
            if tag == "equal" or (tag == "replace" and j - i == l - k == 1):
                for ri, hi in zip(range(i, j), range(k, l)):
                    aligned[hi] = (ri, ref[ri])
        for position, source in enumerate(hyp):
            left = hyp[position - 1] if position else "<BOS>"
            right = hyp[position + 1] if position + 1 < len(hyp) else "<EOS>"
            global_key, context_key = (source, None, None), (source, left, right)
            evidence = {"id": record["id"], "audio_name": record["audio_name"], "hypothesis_word_index": position,
                        "source_revision": record["source_revision"], "asr_signature": record["asr_signature"],
                        "source": source, "left": left, "right": right, "aligned_target": aligned.get(position, (None, None))[1]}
            occurrences[global_key].append(evidence)
            occurrences[context_key].append(evidence)
            if position not in aligned:
                continue
            ref_position, target = aligned[position]
            if source == target or _protected((source, target)):
                continue
            examples[(global_key, target)].append(evidence)
            ref_left = ref[ref_position - 1] if ref_position else "<BOS>"
            ref_right = ref[ref_position + 1] if ref_position + 1 < len(ref) else "<EOS>"
            if (left, right) == (ref_left, ref_right):
                examples[(context_key, target)].append(evidence)
    rules, audit = [], []
    for (key, target), evidence in sorted(examples.items(), key=lambda item: repr(item[0])):
        source, left, right = key
        contextual = left is not None
        support = len(evidence)
        independent = len({row["id"] for row in evidence})
        exposure = len(occurrences[key])
        confidence = support / exposure
        reasons = []
        if independent < (2 if contextual else 3):
            reasons.append("insufficient_independent_train_utterances")
        if confidence < (1.0 if contextual else 0.98):
            reasons.append("ambiguous_train_exposure")
        if not contextual and reference_vocabulary[source]:
            reasons.append("source_is_valid_train_reference_token")
        entry = {"source": source, "target": target, "left": left, "right": right,
                 "support": support, "support_utterances": independent, "exposures": exposure,
                 "confidence": confidence, "source_reference_frequency": reference_vocabulary[source],
                 "evidence": evidence, "exposure_evidence": occurrences[key], "rejection_reasons": reasons}
        entry["rule_id"] = signature({"source": source, "target": target, "left": left, "right": right})
        audit.append(entry)
        if not reasons:
            rules.append(entry)
    rules.sort(key=lambda row: (row["left"] is None, -row["support"], row["rule_id"]))
    rulebook = {
        "version": _VERSION, "rules": rules, "candidate_audit": audit,
        "policy": {"learning_split": "train", "normalization": "NFC and whitespace; preserve case/punctuation outside replacement spans",
                   "alignment": "RapidFuzz Levenshtein unit-cost opcodes", "replacement": "single noncascading pass; context-specific before global",
                   "contextual_min_utterances": 2, "contextual_precision": 1.0, "global_min_utterances": 3, "global_precision": 0.98,
                   "protected_tokens": sorted(_NEGATIONS | _UNITS), "protect_any_digit": True},
        "train_records_signature": signature(sorted(usable, key=lambda row: row["id"])),
        "train_ids": sorted(record["id"] for record in usable),
        "excluded_duplicate_ids": sorted(record["id"] for record in train_records if record.get("duplicate_excluded", False)),
        "source_revision": cfg["source"]["revision"], "provenance": _provenance(cfg),
        "status": "learned_rules" if rules else "no_candidates_met_predeclared_thresholds",
    }
    # Execution metadata changes on a clean rerun/commit; only semantic rule content
    # participates in the immutable rule identity. The artifact manifest hashes all bytes.
    rulebook["signature"] = signature({key: value for key, value in rulebook.items() if key != "provenance"})
    write_json(Path(cfg["outputs_dir"]) / "rules" / "rulebook.json", rulebook)
    return rulebook


def apply_rules(text, rulebook):
    normalized = normalize_text(text)
    matches = list(_WORD.finditer(normalized))
    tokens = [match.group().lower() for match in matches]
    by_source = defaultdict(list)
    for rule in rulebook["rules"]:
        by_source[rule["source"]].append(rule)
    replacements = []
    for index, (match, token) in enumerate(zip(matches, tokens)):
        left = tokens[index - 1] if index else "<BOS>"
        right = tokens[index + 1] if index + 1 < len(tokens) else "<EOS>"
        for rule in by_source.get(token, ()):
            if rule["left"] is not None and (rule["left"], rule["right"]) != (left, right):
                continue
            target = rule["target"]
            if match.group().isupper():
                target = target.upper()
            elif match.group().istitle():
                target = target.title()
            replacements.append((match.start(), match.end(), target))
            break
    for start, end, target in reversed(replacements):
        normalized = normalized[:start] + target + normalized[end:]
    return normalized


def _entity_label(label):
    match = re.match(r"^([BIESUL])-+(.*)$", label)
    prefix, kind = match.groups() if match else ("", label)
    return prefix, kind


def _aggregate_entities(text, tokens):
    entities, current = [], None
    for token in sorted(tokens, key=lambda row: (row["start"], row["end"])):
        prefix, kind = _entity_label(token["label"])
        if kind.casefold() in _BACKGROUND:
            current = None
            continue
        adjacent = current is not None and token["start"] >= current["end"] and not text[current["end"]:token["start"]].strip()
        if adjacent and current["label"] == kind and prefix not in {"B", "S", "U"} and not current.pop("closed", False):
            current["end"] = token["end"]
            current["scores"].append(token["score"])
        else:
            current = {"start": token["start"], "end": token["end"], "label": kind, "scores": [token["score"]]}
            entities.append(current)
        current["closed"] = prefix in {"E", "L", "S", "U"}
    return [{"start": entity["start"], "end": entity["end"], "text": text[entity["start"]:entity["end"]],
             "label": entity["label"], "score": statistics.mean(entity["scores"])} for entity in entities]


def _infer_entities(text, tokenizer, model, cfg, max_length, stride):
    import torch
    if not text.strip():
        return []
    encoded = tokenizer(text, truncation=True, max_length=max_length, stride=stride,
                        return_overflowing_tokens=True, return_offsets_mapping=True,
                        return_special_tokens_mask=True, padding=False)
    windows = len(encoded["input_ids"])
    selected = {}
    for batch_start in range(0, windows, cfg["ner_batch_size"]):
        indices = range(batch_start, min(windows, batch_start + cfg["ner_batch_size"]))
        features = [{key: encoded[key][index] for key in tokenizer.model_input_names if key in encoded} for index in indices]
        batch = tokenizer.pad(features, padding=True, return_tensors="pt").to(cfg["device"])
        with torch.inference_mode():
            logits = model(**batch).logits
            if not torch.isfinite(logits).all():
                raise RuntimeError("NER produced non-finite logits")
            scores, labels = logits.float().softmax(-1).max(-1)
        scores, labels = scores.cpu().tolist(), labels.cpu().tolist()
        for batch_index, window in enumerate(indices):
            offsets = encoded["offset_mapping"][window]
            valid = [index for index, (start, end) in enumerate(offsets) if end > start and not encoded["special_tokens_mask"][window][index]]
            for rank, token_index in enumerate(valid):
                start, end = offsets[token_index]
                if not 0 <= start < end <= len(text):
                    raise ValueError("NER tokenizer returned invalid character offsets")
                # Prefer the window with the most context on both sides; overlap is never double-counted.
                priority = (min(rank, len(valid) - 1 - rank), scores[batch_index][token_index], -window)
                key = (start, end)
                if key not in selected or priority > selected[key][0]:
                    label_index = labels[batch_index][token_index]
                    label = model.config.id2label.get(label_index, model.config.id2label.get(str(label_index)))
                    if label is None:
                        raise ValueError(f"NER label {label_index} has no checkpoint mapping")
                    selected[key] = (priority, {"start": start, "end": end, "label": str(label), "score": scores[batch_index][token_index]})
    return _aggregate_entities(text, [value[1] for value in selected.values()])


def _entity_multiset(entities):
    return Counter((normalize_for_scoring(entity["text"]), entity["label"]) for entity in entities
                   if _entity_label(entity["label"])[1].casefold() not in _BACKGROUND)


def _consistency(reference_entities, candidate_entities):
    reference, candidate = _entity_multiset(reference_entities), _entity_multiset(candidate_entities)
    matched = sum((reference & candidate).values())
    ref_count, candidate_count = sum(reference.values()), sum(candidate.values())
    return {"matched": matched, "reference_predicted_entities": ref_count, "candidate_predicted_entities": candidate_count,
            "consistency_precision": _ratio(matched, candidate_count), "consistency_retention": _ratio(matched, ref_count),
            "consistency_f1": _ratio(2 * matched, ref_count + candidate_count)}


def run_ner_consistency(cfg, records, predictions_by_run, split_name):
    """Compare frozen predictions to reference-text predictions, never gold labels."""
    indexed = _index(records)
    for run, predictions in predictions_by_run.items():
        _component(run)
        _join(indexed, predictions, run)
    if "reference" in predictions_by_run:
        raise ValueError("'reference' is reserved for reference-text NER predictions")
    if "R0" in predictions_by_run and predictions_by_run["R0"] != {key: row["hypothesis_text"] for key, row in indexed.items()}:
        raise ValueError("R0 must be the original raw ASR outputs")
    runs = {"R0": {key: row["hypothesis_text"] for key, row in indexed.items()}, **predictions_by_run}
    ner_spec = cfg["models"]["ner"]
    if not re.fullmatch(r"[0-9a-fA-F]{40}", ner_spec["revision"]) or not ner_spec.get("hashes"):
        raise ValueError("NER requires a pinned commit SHA and local artifact hashes")
    model_root = Path(ner_spec["path"]).resolve()
    for relative_path, expected_hash in ner_spec["hashes"].items():
        relative = Path(relative_path)
        local_path = model_root / relative
        # Hub snapshots may use symlinks into the blob store; verify bytes, not symlink location.
        if relative.is_absolute() or ".." in relative.parts or not local_path.is_file():
            raise ValueError(f"Invalid pinned NER artifact path: {relative_path}")
        if sha256_file(local_path) != expected_hash:
            raise ValueError(f"Pinned NER artifact hash mismatch: {relative_path}")
    from transformers import AutoModelForTokenClassification, AutoTokenizer
    model = tokenizer = None
    try:
        tokenizer = AutoTokenizer.from_pretrained(ner_spec["path"], use_fast=True, local_files_only=True)
        if not tokenizer.is_fast:
            raise ValueError("NER overflow aggregation requires a fast tokenizer with offsets")
        model = AutoModelForTokenClassification.from_pretrained(ner_spec["path"], local_files_only=True).to(cfg["device"]).eval()
        model.requires_grad_(False)
        limits = [512]
        if tokenizer.model_max_length < 1_000_000:
            limits.append(tokenizer.model_max_length)
        if getattr(model.config, "max_position_embeddings", None):
            # RoBERTa reserves padding_idx+1 position indices before real tokens.
            reserve = (model.config.pad_token_id or 0) + 1 if model.config.model_type in {"roberta", "xlm-roberta"} else 0
            limits.append(model.config.max_position_embeddings - reserve)
        max_length = min(limits)
        capacity = max_length - tokenizer.num_special_tokens_to_add(pair=False)
        if capacity < 2:
            raise ValueError("NER checkpoint has no usable token context")
        stride = min(128, capacity // 4)
        ner_manifest = {"model": ner_spec, "config": model.config.to_dict(), "tokenizer_class": type(tokenizer).__name__,
                        "max_length": max_length, "stride": stride, "overflow_policy": "deduplicate token offsets, max context then confidence then earliest window",
                        "aggregation": "simple contiguous same-type; BIO/BILOU boundaries respected", "background": sorted(_BACKGROUND),
                        "entity_normalization": _POLICY["normalization"], "precision": "float32", "device": cfg["device"],
                        "environment": {key: cfg["environment"][key] for key in
                                        ("python", "libraries", "cuda", "gpu", "compute_capability", "precision", "nvml")},
                        "code_sha256": sha256_file(Path(__file__)),
                        "common_code_sha256": sha256_file(Path(__file__).with_name("common.py")),
                        "scoring_code_sha256": sha256_file(Path(cfg["root"]) / "experiments/001-zeroshot-correction-vietmed/scripts/text-normalization-utils.py")}
        ner_signature = signature(ner_manifest)
        cache_root = Path(cfg["derived_dir"]) / "ner_cache" / ner_signature
        texts = {row["reference_text"] for row in records}
        texts.update(text for predictions in runs.values() for text in predictions.values())
        entities_by_text = {}
        for text in sorted(texts):
            key = signature({"text": text, "ner_signature": ner_signature})
            path = cache_root / f"{key}.json"
            cached = read_json(path) if path.exists() else None
            if cached is not None:
                body = {name: value for name, value in cached.items() if name != "signature"}
                if cached.get("signature") != signature(body) or cached.get("text") != text or cached.get("ner_signature") != ner_signature:
                    raise ValueError(f"Invalid NER cache provenance: {path}")
                entities = cached["entities"]
            else:
                entities = _infer_entities(text, tokenizer, model, cfg, max_length, stride)
                cached = {"text": text, "ner_signature": ner_signature, "entities": entities}
                cached["signature"] = signature(cached)
                write_json(path, cached)
            entities_by_text[text] = entities
        reference_rows = [{"id": key, "text": row["reference_text"], "entities": entities_by_text[row["reference_text"]],
                           "role": "reference_text_prediction_not_gold"} for key, row in indexed.items()]
        directory = Path(cfg["outputs_dir"]) / "ner" / _component(split_name)
        reference_path = directory / "reference_predictions.jsonl"
        write_jsonl(reference_path, reference_rows)
        summaries, paths = {}, [reference_path]
        for run, predictions in runs.items():
            rows = []
            for identifier, record in indexed.items():
                entities = entities_by_text[predictions[identifier]]
                rows.append({"id": identifier, "audio_name": record["audio_name"], "text": predictions[identifier], "entities": entities,
                             **_consistency(entities_by_text[record["reference_text"]], entities)})
            matched = sum(row["matched"] for row in rows)
            ref_count = sum(row["reference_predicted_entities"] for row in rows)
            pred_count = sum(row["candidate_predicted_entities"] for row in rows)
            summaries[run] = {"num_samples": len(rows), "matched": matched, "reference_predicted_entities": ref_count,
                              "candidate_predicted_entities": pred_count, "consistency_precision": _ratio(matched, pred_count),
                              "consistency_retention": _ratio(matched, ref_count), "consistency_f1": _ratio(2 * matched, ref_count + pred_count),
                              "both_entity_sets_empty_samples": sum(row["reference_predicted_entities"] == row["candidate_predicted_entities"] == 0 for row in rows),
                              "interpretation": "NER prediction consistency, not gold NER F1 or clinical quality",
                              "zero_denominator": "null; both-empty contributes zero entity counts"}
            path = directory / f"{run}.jsonl"
            write_jsonl(path, rows)
            paths.append(path)
        summary_path = directory / "summary.json"
        result = {"runs": summaries, "ner_signature": ner_signature, "ner_manifest": ner_manifest}
        write_json(summary_path, result)
        _manifest(directory, {**_provenance(cfg), "ner_signature": ner_signature,
                              "records_signature": signature(sorted(records, key=lambda row: row["id"])),
                              "predictions_signature": signature(runs)}, [*paths, summary_path])
        return result
    finally:
        del model, tokenizer
        release_gpu()


def _raw_stratum(record):
    ref = normalize_for_scoring(record["reference_text"])
    raw = normalize_for_scoring(record["hypothesis_text"])
    metric = _text_metrics(ref, raw)
    if metric["wer"] is None:
        level = "empty_reference"
    elif metric["errors"] == 0:
        level = "correct"
    elif metric["wer"] <= 0.1:
        level = "low_0_to_10pct"
    elif metric["wer"] <= 0.3:
        level = "medium_10_to_30pct"
    else:
        level = "high_above_30pct"
    return record["audio_name"], level


def _risk_flags(raw, candidate):
    # Surface cues only: no drug lexicon is inferred from held-out references.
    raw_tokens, candidate_tokens = normalize_for_scoring(raw).split(), normalize_for_scoring(candidate).split()
    number_pattern = r"\d+(?:[.,:/-]\d+)*"
    flags = []
    if re.findall(number_pattern, raw) != re.findall(number_pattern, candidate):
        flags.append("number_or_numeric_format_changed")
    for name, vocabulary in (("negation_cue_changed", _NEGATIONS), ("unit_cue_changed", _UNITS)):
        if Counter(token for token in raw_tokens if token in vocabulary) != Counter(token for token in candidate_tokens if token in vocabulary):
            flags.append(name)
    if raw != candidate and ("%" in raw or "%" in candidate) and raw.count("%") != candidate.count("%"):
        flags.append("percent_sign_changed")
    opcodes = list(_opcodes(raw_tokens, candidate_tokens))
    if any(tag != "equal" and l > k and (k == 0 or l == len(candidate_tokens)) for tag, i, j, k, l in opcodes):
        flags.append("boundary_addition_or_replacement_needs_audio_check")
    if any(tag != "equal" and j > i for tag, i, j, k, l in opcodes):
        flags.append("removed_or_replaced_content_needs_audio_check")
    if raw != candidate:
        flags.append("changed_text_terms_and_content_need_human_review")
    return flags


def _write_csv(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def export_review(cfg, dev_records, predictions_by_run):
    """Call with {} before corrections to freeze the dev sample independently."""
    indexed = _index(dev_records)
    if any(row["split"] != "dev" or not key.startswith("dev:") for key, row in indexed.items()):
        raise ValueError("Content-review sampling only accepts original dev records")
    for run, predictions in predictions_by_run.items():
        _component(run)
        _join(indexed, predictions, run)
    if len(indexed) < 200 and cfg["mode"] != "smoke":
        raise ValueError("Full protocol requires at least 200 development utterances")
    directory = Path(cfg["outputs_dir"]) / "review"
    assignment_path = directory / "sample_assignment.json"
    pool = [{"id": key, "audio_name": row["audio_name"], "reference_text": row["reference_text"],
             "hypothesis_text": row["hypothesis_text"], "audio_sha256": row["audio_sha256"],
             "asr_signature": row["asr_signature"], "source_revision": row["source_revision"]} for key, row in sorted(indexed.items())]
    pool_signature = signature(pool)
    if assignment_path.exists():
        assignment = read_json(assignment_path)
        body = {key: value for key, value in assignment.items() if key != "signature"}
        if assignment.get("signature") != signature(body) or assignment["pool_signature"] != pool_signature:
            raise ValueError("Frozen review pool changed; do not silently resample")
    else:
        rng = random.Random(42)
        strata = defaultdict(list)
        for key, row in sorted(indexed.items()):
            strata[_raw_stratum(row)].append(key)
        target = min(200, len(indexed))
        allocations = {key: 0 for key in strata}
        # Balanced recording/error strata, redistributing exhausted strata; not prevalence weighting.
        order = sorted(strata)
        rng.shuffle(order)
        while sum(allocations.values()) < target:
            for key in order:
                if allocations[key] < len(strata[key]) and sum(allocations.values()) < target:
                    allocations[key] += 1
        selected = []
        for key in sorted(strata):
            identifiers = sorted(strata[key])
            rng.shuffle(identifiers)
            selected.extend({"id": identifier, "audio_name": key[0], "raw_error_stratum": key[1]} for identifier in identifiers[:allocations[key]])
        rng.shuffle(selected)
        for number, row in enumerate(selected, 1):
            row["sample_id"] = f"D{number:03d}"
        assignment = {"seed": 42, "requested_samples": 200, "actual_samples": target, "mode": cfg["mode"],
                      "pool_signature": pool_signature, "selection_inputs": "recording and raw ASR error only; no corrected output",
                      "sampling": "balanced round-robin recording x raw-error strata, seeded sampling without replacement",
                      "interpretation": "stratified descriptive review; unweighted rates do not estimate full-corpus prevalence",
                      "strata": [{"audio_name": key[0], "raw_error_stratum": key[1], "population": len(strata[key]), "sampled": allocations[key]} for key in sorted(strata)],
                      "samples": selected}
        assignment["signature"] = signature(assignment)
        write_json(assignment_path, assignment)
    result = {"assignment": str(assignment_path)}
    if not predictions_by_run:
        return result
    key_path = directory / "blinding_key.json"
    names = sorted(predictions_by_run)
    if key_path.exists():
        mapping = read_json(key_path)
        body = {key: value for key, value in mapping.items() if key != "signature"}
        if mapping.get("signature") != signature(body) or mapping["assignment_signature"] != assignment["signature"] or mapping["run_names"] != names:
            raise ValueError("Frozen blinded run matrix changed")
    else:
        rng = random.Random(42)
        rows = []
        for sample in assignment["samples"]:
            shuffled = list(names)
            rng.shuffle(shuffled)
            for index, run in enumerate(shuffled, 1):
                rows.append({"sample_id": sample["sample_id"], "id": sample["id"], "variant_id": f"{sample['sample_id']}-V{index:02d}", "run_name": run})
        rng.shuffle(rows)
        mapping = {"seed": 42, "assignment_signature": assignment["signature"], "run_names": names, "rows": rows,
                   "access": "coordinator only; do not distribute this key to blinded reviewers"}
        mapping["signature"] = signature(mapping)
        write_json(key_path, mapping)
        key_path.chmod(0o600)
    rows = []
    for variant in mapping["rows"]:
        record = indexed[variant["id"]]
        prediction = predictions_by_run[variant["run_name"]][variant["id"]]
        rows.append({"sample_id": variant["sample_id"], "variant_id": variant["variant_id"], "utterance_id": record["id"],
                     "audio_path": record["audio_path"], "audio_name": record["audio_name"],
                     "reference_text": record["reference_text"], "raw_asr_text": record["hypothesis_text"], "candidate_text": prediction,
                     "surface_risk_flags": ";".join(_risk_flags(record["hypothesis_text"], prediction)),
                     "flag_interpretation": "Conservative surface cues, not clinical judgments or a complete safety detector",
                     "review_status": "pending", "reviewer_id": "", "error_category": "", "severity": "", "notes": "",
                     "second_reviewer_id": "", "second_error_category": "", "second_severity": "", "second_notes": "",
                     "adjudicator_id": "", "adjudication": "", "suspected_reference_error": ""})
    fields = ["sample_id", "variant_id", "utterance_id", "audio_path", "audio_name", "reference_text", "raw_asr_text", "candidate_text",
              "surface_risk_flags", "flag_interpretation", "review_status", "reviewer_id", "error_category", "severity", "notes",
              "second_reviewer_id", "second_error_category", "second_severity", "second_notes", "adjudicator_id", "adjudication", "suspected_reference_error"]
    csv_path = directory / "blinded_review.csv"
    # Never erase real review annotations on rerun. New predictions require explicit artifact management.
    export_signature = signature({"assignment": assignment["signature"], "mapping": mapping["signature"], "predictions": predictions_by_run})
    export_state_path = directory / "export_state.json"
    if csv_path.exists():
        if not export_state_path.exists() or read_json(export_state_path)["export_signature"] != export_signature:
            raise ValueError("Existing review export has different predictions; refusing to overwrite")
    else:
        _write_csv(csv_path, fields, rows)
        write_json(export_state_path, {"export_signature": export_signature, "initial_csv_sha256": sha256_file(csv_path)})
    result.update({"blinded_csv": str(csv_path), "blinding_key": str(key_path), "export_state": str(export_state_path)})
    return result


def _quantile(values, probability):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def bootstrap_comparison(cfg, reports_by_run, split_name):
    """Paired recording-cluster resampling; positive delta WER means worse."""
    if "R0" not in reports_by_run:
        raise ValueError("Recording-cluster comparison requires R0")
    replicates = cfg["bootstrap"]["replicates"]
    if replicates != 2000:
        raise ValueError("Protocol fixes bootstrap replicates at 2000")
    base_rows = reports_by_run["R0"]["per_sample"]
    baseline = {row["id"]: row for row in base_rows}
    if len(baseline) != len(base_rows):
        raise ValueError("Duplicate baseline evaluation IDs")
    clusters = sorted({row["audio_name"] for row in base_rows})
    cluster_index = {name: index for index, name in enumerate(clusters)}
    denominators = [0] * len(clusters)
    base_errors = [0] * len(clusters)
    for row in base_rows:
        index = cluster_index[row["audio_name"]]
        if row["errors"] != row["raw_errors"] or row["changes"]["raw_string"]:
            raise ValueError("R0 report is not raw ASR")
        denominators[index] += row["reference_words"]
        base_errors[index] += row["errors"]
    rng = random.Random(cfg["bootstrap"]["seed"])
    draws = [[rng.randrange(len(clusters)) for _ in clusters] for _ in range(replicates)] if clusters else [[] for _ in range(replicates)]
    draw_denominators = [sum(denominators[index] for index in draw) for draw in draws]
    run_results, distributions = {}, {}
    for run, report in reports_by_run.items():
        rows = report["per_sample"]
        indexed = {row["id"]: row for row in rows}
        if len(indexed) != len(rows) or set(indexed) != set(baseline):
            raise ValueError(f"{run}: bootstrap requires identical unique sample IDs")
        errors = [0] * len(clusters)
        for identifier, row in indexed.items():
            base = baseline[identifier]
            for field in ("audio_name", "reference_words", "reference_text", "hypothesis_text", "raw_errors"):
                if row[field] != base[field]:
                    raise ValueError(f"{run}/{identifier}: unpaired evaluation field {field}")
            errors[cluster_index[row["audio_name"]]] += row["errors"]
        differences = [candidate - raw for candidate, raw in zip(errors, base_errors)]
        distribution = [_ratio(sum(differences[index] for index in draw), denominator) for draw, denominator in zip(draws, draw_denominators)]
        distributions[run] = distribution
        defined = [value for value in distribution if value is not None]
        delta = _ratio(sum(differences), sum(denominators))
        run_results[run] = {"wer": _ratio(sum(errors), sum(denominators)), "raw_wer": _ratio(sum(base_errors), sum(denominators)),
                            "delta_wer_to_R0": delta, "ci95_percentile": [_quantile(defined, 0.025), _quantile(defined, 0.975)],
                            "defined_replicates": len(defined), "undefined_replicates": replicates - len(defined),
                            "cluster_errors": dict(zip(clusters, errors))}
    seed_runs = {}
    for run in reports_by_run:
        match = re.fullmatch(r"R3[-_](?:seed[-_]?)?(42|43|44)", run, re.IGNORECASE)
        if match:
            seed = int(match.group(1))
            if seed in seed_runs:
                raise ValueError(f"Multiple R3 reports for seed {seed}")
            seed_runs[seed] = run
    seed_values = [run_results[run]["wer"] for seed, run in sorted(seed_runs.items())]
    defined_seed_values = [value for value in seed_values if value is not None]
    deltas = [run_results[run]["delta_wer_to_R0"] for seed, run in sorted(seed_runs.items())]
    defined_deltas = [value for value in deltas if value is not None]
    mean_distribution = []
    for replicate in range(replicates):
        values = [distributions[run][replicate] for run in seed_runs.values()]
        if values and all(value is not None for value in values):
            mean_distribution.append(statistics.mean(values))
    seed_summary = {"runs_by_seed": {str(seed): run for seed, run in sorted(seed_runs.items())},
                    "missing_protocol_seeds": sorted({42, 43, 44} - set(seed_runs)),
                    "status": "complete" if set(seed_runs) == {42, 43, 44} else "incomplete_seed_matrix",
                    "wer_mean": statistics.mean(defined_seed_values) if defined_seed_values else None,
                    "wer_std": statistics.stdev(defined_seed_values) if len(defined_seed_values) > 1 else None,
                    "delta_wer_mean": statistics.mean(defined_deltas) if defined_deltas else None,
                    "delta_wer_std": statistics.stdev(defined_deltas) if len(defined_deltas) > 1 else None,
                    "std_policy": "sample standard deviation across seeds, ddof=1; null for fewer than two defined seeds",
                    "mean_delta_ci95_percentile": [_quantile(mean_distribution, 0.025), _quantile(mean_distribution, 0.975)],
                    "mean_delta_defined_replicates": len(mean_distribution),
                    "resampling_policy": "same recording draws for every seed, mean of per-seed ratios; never pooled utterances"}
    result = {"split_name": split_name, "runs": run_results, "R3_seeds": seed_summary,
              "replicates": replicates, "seed": cfg["bootstrap"]["seed"], "cluster_count": len(clusters),
              "cluster_reference_words": dict(zip(clusters, denominators)),
              "delta_direction": "candidate minus R0; negative is improvement", "unit": "WER ratio, not percentage points",
              "zero_denominator": "null; undefined resamples excluded from percentile CI and counted explicitly",
              "limitations": "Few recording clusters limit uncertainty estimates; one-cluster bootstrap is degenerate. CI does not establish clinical safety.",
              "report_signatures": {run: signature(report["per_sample"]) for run, report in reports_by_run.items()}}
    directory = Path(cfg["outputs_dir"]) / "bootstrap" / _component(split_name)
    result_path = directory / "comparison.json"
    draws_path = directory / "replicates.jsonl"
    write_json(result_path, result)
    write_jsonl(draws_path, [{"replicate": index, "recording_indices": draw, "reference_words": draw_denominators[index],
                            "delta_wer_by_run": {run: distribution[index] for run, distribution in distributions.items()}} for index, draw in enumerate(draws)])
    _manifest(directory, {**_provenance(cfg), "split_name": split_name, "bootstrap": cfg["bootstrap"],
                          "report_signatures": result["report_signatures"]}, [result_path, draws_path])
    return result
