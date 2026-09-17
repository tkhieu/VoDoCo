"""Pinned VietMed audio audit, resumable Whisper cache, and R3 supervision."""
from __future__ import annotations

from collections import Counter, defaultdict
from contextlib import contextmanager
import copy
import fcntl
import hashlib
import io
import math
import os
from pathlib import Path
import re
import tempfile

from common import (
    normalize_for_scoring, normalize_text, read_json, read_jsonl, release_gpu,
    seed_everything, sha256_file, signature, write_json, write_jsonl,
)

OFFICIAL_COUNTS = {"train": 2773, "dev": 2912, "test": 3437, "cv": 85}
GROUP_COUNTS = {"train": (5, 13), "dev": (10, 21), "test": (14, 27), "cv": (5, 13)}
SHARED_RECORDING = "VietMed_019"
PCM_POLICY = "soundfile decoded float32 little-endian interleaved; hash sample rate/channels/frames and PCM; WAV FLOAT export"


def _namespace(cfg):
    if cfg["mode"] not in {"full", "smoke"}:
        raise ValueError("mode must be full or smoke")
    return Path(cfg["derived_dir"]) / cfg["mode"]


@contextmanager
def _lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _immutable_json(path, value):
    path = Path(path)
    with _lock(path.with_suffix(path.suffix + ".lock")):
        if path.exists():
            if signature(read_json(path)) != signature(value):
                raise ValueError(f"Immutable snapshot differs: {path}")
        else:
            write_json(path, value)


def _immutable_jsonl(path, rows):
    path = Path(path)
    with _lock(path.with_suffix(path.suffix + ".lock")):
        if path.exists():
            if signature(read_jsonl(path)) != signature(rows):
                raise ValueError(f"Immutable snapshot differs: {path}")
        else:
            write_jsonl(path, rows)


def _source_files(cfg):
    source = cfg["source"]
    if source["repo_id"] != "leduckhai/VietMed" or not re.fullmatch(r"[0-9a-f]{40}", source["revision"]):
        raise ValueError("Expected pinned leduckhai/VietMed commit")
    root = Path(cfg["root"]).resolve()
    directory = (root / source["local_directory"]).resolve()
    directory.relative_to(root)
    checked = []
    seen = set()
    for item in source["files"]:
        if item["path"] in seen:
            raise ValueError(f"Duplicate source manifest path: {item['path']}")
        seen.add(item["path"])
        path = (directory / item["path"]).resolve()
        path.relative_to(directory)
        size = path.stat().st_size
        if size != item["bytes"]:
            raise ValueError(f"Source size mismatch: {path}")
        algorithm = item["hash_algorithm"]
        if algorithm == "sha256":
            digest = sha256_file(path)
        elif algorithm == "git-blob-sha1":
            hasher = hashlib.sha1()
            hasher.update(f"blob {size}\0".encode())
            with path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    hasher.update(block)
            digest = hasher.hexdigest()
        else:
            raise ValueError(f"Unsupported source hash: {algorithm}")
        if digest != item["hash"]:
            raise ValueError(f"Source hash mismatch: {path}")
        checked.append({**item, "sha256": digest if algorithm == "sha256" else sha256_file(path)})
    return directory, checked


def _pcm_hash(audio, sample_rate):
    import numpy as np
    audio = np.asarray(audio, dtype="<f4", order="C")
    if audio.ndim != 2 or not audio.size or sample_rate <= 0 or not np.isfinite(audio).all():
        raise ValueError("Invalid/empty/non-finite decoded audio")
    digest = hashlib.sha256()
    digest.update(f"pcm-f32le:{sample_rate}:{audio.shape[1]}:{audio.shape[0]}\n".encode())
    digest.update(memoryview(audio).cast("B"))
    return digest.hexdigest()


def _export_audio(path, audio, sample_rate, expected_hash):
    import soundfile as sf
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        existing, rate = sf.read(path, dtype="float32", always_2d=True)
        if _pcm_hash(existing, rate) != expected_hash:
            raise ValueError(f"Existing audio export corrupt: {path}")
        return
    fd, temporary = tempfile.mkstemp(prefix=path.stem + ".", suffix=".wav", dir=path.parent)
    os.close(fd)
    try:
        sf.write(temporary, audio, sample_rate, format="WAV", subtype="FLOAT")
        with open(temporary, "rb") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _derived_split(split, recording):
    if split == "dev":
        return "dev_shared_recording" if recording == SHARED_RECORDING else "dev_tune"
    return {"train": "train_real", "test": "test_official", "cv": "cv_diagnostic"}[split]


def prepare_data(cfg):
    """Audit every source/audio row before selecting explicitly namespaced smoke rows."""
    import numpy as np
    import pyarrow.parquet as pq
    import soundfile as sf

    base = _namespace(cfg)
    root = Path(cfg["root"]).resolve()
    directory, checked = _source_files(cfg)
    source_signature = signature(cfg["source"])
    snapshot = Path(cfg["derived_dir"]) / "source_snapshots" / source_signature
    _immutable_json(snapshot / "source.json", {"source": cfg["source"], "verified_files": checked})
    all_records = {}
    audio_audit = []
    by_pcm = defaultdict(list)
    by_reference = defaultdict(list)
    by_metadata = defaultdict(list)
    manifest_paths = {item["path"] for item in checked}
    for split, expected in OFFICIAL_COUNTS.items():
        relative = f"data/{split}-00000-of-00001.parquet"
        if relative not in manifest_paths:
            raise ValueError(f"Parquet absent from pinned source manifest: {relative}")
        parquet = pq.ParquetFile(directory / relative)
        if parquet.metadata.num_rows != expected:
            raise ValueError(f"Official {split} count differs: {parquet.metadata.num_rows} != {expected}")
        records, raw_rows, ids = [], [], set()
        for batch in parquet.iter_batches(batch_size=64):
            for raw in batch.to_pylist():
                uid = raw["utterance_id"]
                if not isinstance(uid, str) or not re.fullmatch(rf"utt_id_{split}_\d{{6}}", uid):
                    raise ValueError(f"Unexpected upstream ID in {split}: {uid!r}")
                identifier = f"{split}:{uid}"
                if identifier in ids:
                    raise ValueError(f"Duplicate ID: {identifier}")
                ids.add(identifier)
                for key in ("text", "audio_name", "speaker_name", "seq_name"):
                    if not isinstance(raw[key], str):
                        raise ValueError(f"Invalid {key}: {identifier}")
                if not raw["audio_name"] or not raw["speaker_name"] or not raw["seq_name"]:
                    raise ValueError(f"Missing grouping metadata: {identifier}")
                encoded = raw["audio"]["bytes"]
                if not isinstance(encoded, bytes) or not encoded:
                    raise ValueError(f"Missing embedded audio: {identifier}")
                audio, rate = sf.read(io.BytesIO(encoded), dtype="float32", always_2d=True)
                pcm_hash = _pcm_hash(audio, rate)
                duration = len(audio) / rate
                reported = float(raw["duration"])
                if not math.isfinite(reported) or reported <= 0:
                    raise ValueError(f"Invalid upstream duration: {identifier}")
                audio_path = Path(cfg["derived_dir"]) / "audio" / pcm_hash[:2] / f"{pcm_hash}.wav"
                _export_audio(audio_path, audio, rate, pcm_hash)
                record = {
                    "id": identifier, "utterance_id": uid, "split": split,
                    "derived_split": _derived_split(split, raw["audio_name"]),
                    "source_revision": cfg["source"]["revision"], "source_manifest_signature": source_signature,
                    "audio_name": raw["audio_name"], "speaker_name": raw["speaker_name"],
                    "seq_name": raw["seq_name"], "reference_text": raw["text"],
                    "audio_path": str(audio_path.resolve().relative_to(root)), "audio_sha256": pcm_hash,
                    "duration": duration, "sample_rate": rate, "channels": audio.shape[1],
                    "frames": len(audio), "reported_duration": reported, "duplicate_excluded": False,
                    "source_audio_sha256": hashlib.sha256(encoded).hexdigest(),
                    "source_audio_path": raw["audio"]["path"],
                    "metadata": {key: raw[key] for key in ("role", "gender", "accent", "icd10_code", "rec_condition")},
                }
                raw_rows.append({**{k: v for k, v in raw.items() if k != "audio"}, "audio": {
                    "path": raw["audio"]["path"], "encoded_bytes": len(encoded),
                    "encoded_sha256": record["source_audio_sha256"], "decoded_pcm_sha256": pcm_hash,
                }})
                audio_audit.append({"id": identifier, "sample_rate": rate, "channels": audio.shape[1],
                                    "frames": len(audio), "duration": duration, "reported_duration": reported,
                                    "duration_delta": duration - reported, "peak": float(np.abs(audio).max()),
                                    "rms": float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))),
                                    "silent": bool(not np.any(audio)), "longer_than_30_seconds": duration > 30,
                                    "reference_empty_normalized": not bool(normalize_for_scoring(raw["text"])),
                                    "audio_sha256": pcm_hash})
                records.append(record)
                by_pcm[pcm_hash].append(record)
                by_reference[normalize_for_scoring(raw["text"])].append(record)
                by_metadata[(split, raw["seq_name"], raw["text"], reported)].append(record)
        _immutable_jsonl(snapshot / f"{split}.jsonl", raw_rows)
        groups = (len({r["audio_name"] for r in records}), len({r["speaker_name"] for r in records}))
        if groups != GROUP_COUNTS[split]:
            raise ValueError(f"Official metadata group counts differ for {split}: {groups}")
        all_records[split] = records

    duplicate_groups = []
    for pcm_hash, members in sorted(by_pcm.items()):
        if len(members) < 2:
            continue
        matching = defaultdict(list)
        for record in members:
            # Raw-reference equality is deliberately stricter than scoring equivalence.
            matching[record["reference_text"]].append(record)
        confirmed = []
        for same_reference in matching.values():
            train = sorted((r for r in same_reference if r["split"] == "train"), key=lambda r: r["id"])
            for record in train[1:]:
                record["duplicate_excluded"] = True
                record["duplicate_representative_id"] = train[0]["id"]
                record["exclusion_reason"] = "identical_decoded_pcm_and_exact_raw_reference"
            if len(same_reference) > 1:
                confirmed.append(sorted(r["id"] for r in same_reference))
        duplicate_groups.append({"audio_sha256": pcm_hash, "ids": sorted(r["id"] for r in members),
                                 "matching_reference_groups": confirmed,
                                 "has_reference_conflict": len(matching) > 1})
    recording_sets = {s: {r["audio_name"] for r in rows} for s, rows in all_records.items()}
    speaker_sets = {s: {r["speaker_name"] for r in rows} for s, rows in all_records.items()}
    if recording_sets["dev"] & recording_sets["test"] != {SHARED_RECORDING}:
        raise ValueError("Dev/test shared recording protocol differs from pinned audit")
    if recording_sets["train"] & (recording_sets["dev"] | recording_sets["test"]):
        raise ValueError("Unexpected train/held-out recording overlap")
    if recording_sets["cv"] != recording_sets["train"] or speaker_sets["cv"] != speaker_sets["train"]:
        raise ValueError("CV/train diagnostic overlap differs from pinned audit")
    derived_counts = Counter(r["derived_split"] for rows in all_records.values() for r in rows)
    if derived_counts["dev_tune"] != 2769 or derived_counts["dev_shared_recording"] != 143:
        raise ValueError(f"Derived development counts differ: {dict(derived_counts)}")
    write_jsonl(base / "audit" / "audio.jsonl", audio_audit)
    write_json(base / "audit" / "duplicates.json", {
        "pcm_policy": PCM_POLICY, "train_policy": "smallest original ID; exact raw reference and decoded PCM",
        "official_test_unchanged": True, "audio_groups": duplicate_groups,
        "metadata_identical_groups": [sorted(r["id"] for r in rows) for rows in by_metadata.values() if len(rows) > 1],
        "normalized_text_groups": [sorted(r["id"] for r in rows) for rows in by_reference.values() if len(rows) > 1],
    })
    selected = all_records
    if cfg["mode"] == "smoke":
        selected = {}
        for split, rows in all_records.items():
            # Explicit small coverage includes a long utterance when present, and both dev strata.
            count = int(cfg.get("smoke_train_size", 8) if split == "train" else cfg.get("smoke_eval_size", 4))
            if count < 1:
                raise ValueError("Smoke sample size must be positive")
            chosen = sorted(rows, key=lambda r: r["id"])[:count]
            for candidates in ([r for r in rows if r["duration"] > 30],
                               [r for r in rows if r["derived_split"] == "dev_shared_recording"]):
                if candidates:
                    extra = min(candidates, key=lambda r: r["id"])
                    if extra["id"] not in {r["id"] for r in chosen}:
                        chosen.append(extra)
            selected[split] = sorted(chosen, key=lambda r: r["id"])
    for split, rows in all_records.items():
        write_jsonl(base / "manifests" / f"{split}_official.jsonl", rows)
        write_jsonl(base / "manifests" / f"{split}_selected.jsonl", selected[split])
    split_report = {
        "mode": cfg["mode"], "source": cfg["source"], "source_manifest_signature": source_signature,
        "source_snapshot": str(snapshot), "verified_files": checked, "pcm_policy": PCM_POLICY,
        "official_counts": {s: len(rows) for s, rows in all_records.items()},
        "selected_counts": {s: len(rows) for s, rows in selected.items()}, "derived_counts": dict(derived_counts),
        "train_excluded_ids": sorted(r["id"] for r in all_records["train"] if r["duplicate_excluded"]),
        "recordings": {s: sorted(values) for s, values in recording_sets.items()},
        "speakers": {s: sorted(values) for s, values in speaker_sets.items()},
        "recording_intersections": {f"{a}/{b}": sorted(recording_sets[a] & recording_sets[b])
                                    for a in OFFICIAL_COUNTS for b in OFFICIAL_COUNTS if a < b},
        "audio_audit_sha256": sha256_file(base / "audit" / "audio.jsonl"),
        "full_audio_audit_count": len(audio_audit), "seed": cfg["seed"],
    }
    write_json(base / "manifests" / "splits.json", split_report)
    return selected


def _record_identity(record):
    return {key: record[key] for key in (
        "id", "utterance_id", "split", "derived_split", "source_revision", "reference_text",
        "audio_path", "audio_sha256", "duration", "audio_name", "speaker_name", "seq_name", "duplicate_excluded",
    )}


def _verify_records(cfg, records):
    expected = {}
    official = {}
    for split in {record["split"] for record in records}:
        manifest_path = _namespace(cfg) / "manifests" / f"{split}_official.jsonl"
        rows = read_jsonl(manifest_path)
        if len(rows) != OFFICIAL_COUNTS[split] or len({row["id"] for row in rows}) != len(rows):
            raise ValueError(f"Missing/incomplete audited source manifest: {manifest_path}")
        official.update({row["id"]: row for row in rows})
    for record in records:
        identifier = record["id"]
        if identifier in expected or identifier != f"{record['split']}:{record['utterance_id']}":
            raise ValueError(f"Duplicate or malformed record ID: {identifier}")
        if record["source_revision"] != cfg["source"]["revision"]:
            raise ValueError(f"Wrong source revision: {identifier}")
        if record.get("source_manifest_signature") != signature(cfg["source"]):
            raise ValueError(f"Wrong source manifest: {identifier}")
        if record["derived_split"] != _derived_split(record["split"], record["audio_name"]):
            raise ValueError(f"Wrong split assignment: {identifier}")
        if identifier not in official or _record_identity(record) != _record_identity(official[identifier]):
            raise ValueError(f"Record/reference differs from audited source: {identifier}")
        expected[identifier] = record
    return expected


def _asr_audio(cfg, record):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    root = Path(cfg["root"]).resolve()
    path = (root / record["audio_path"]).resolve()
    path.relative_to(root)
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    if _pcm_hash(audio, rate) != record["audio_sha256"]:
        raise ValueError(f"Audio content changed: {record['id']}")
    if abs(len(audio) / rate - record["duration"]) > 1 / rate:
        raise ValueError(f"Audio duration changed: {record['id']}")
    mono = audio.mean(axis=1, dtype=np.float32)
    if rate != 16000:
        divisor = math.gcd(rate, 16000)
        mono = resample_poly(mono, 16000 // divisor, rate // divisor, window=("kaiser", 5.0), padtype="constant")
    return np.ascontiguousarray(mono, dtype=np.float32)


def generate_asr_cache(cfg, records, split_name):
    """Resume only exact signature+ID+reference+PCM matches; commit whole batches atomically."""
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    expected = _verify_records(cfg, records)
    if not expected:
        raise ValueError("Cannot generate an empty ASR split")
    if len({r["split"] for r in records}) != 1:
        raise ValueError("An ASR namespace must contain one official split")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", split_name):
        raise ValueError("Unsafe split cache name")
    selected_rows = read_jsonl(_namespace(cfg) / "manifests" / f"{records[0]['split']}_selected.jsonl")
    if split_name != records[0]["split"]:
        selected_rows = [row for row in selected_rows if row["derived_split"] == split_name]
    if set(expected) != {row["id"] for row in selected_rows}:
        raise ValueError("ASR input IDs do not exactly cover the selected split manifest")
    model_info = cfg["models"]["asr"]
    if not re.fullmatch(r"[0-9a-f]{40}", model_info["revision"]) or not model_info["hashes"]:
        raise ValueError("ASR requires a pinned commit and local model/processor hashes")
    model_root = Path(model_info["path"]).resolve()
    for relative, expected_hash in model_info["hashes"].items():
        local_file = (model_root / relative).resolve()
        local_file.relative_to(model_root)
        if sha256_file(local_file) != expected_hash:
            raise ValueError(f"Pinned ASR/processor file changed: {relative}")
    seed_everything(cfg["seed"])
    dtype = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}[cfg["precision"]]
    model = None
    try:
        processor = WhisperProcessor.from_pretrained(model_info["processor_path"], local_files_only=True)
        model = WhisperForConditionalGeneration.from_pretrained(
            model_info["model_path"], local_files_only=True, torch_dtype=dtype,
        ).to(cfg["device"]).eval()
        generation = copy.deepcopy(model.generation_config)
        generation.language = "vi"
        generation.task = "transcribe"
        generation.forced_decoder_ids = None
        generation.num_beams = 1
        generation.do_sample = False
        generation.num_return_sequences = 1
        generation.max_new_tokens = min(440, model.config.max_target_positions - 4)
        generation.return_dict_in_generate = False
        generation.output_scores = False
        generation.return_timestamps = False
        generation.condition_on_prev_tokens = False
        generation.temperature = 0.0
        generation.compression_ratio_threshold = None
        generation.logprob_threshold = None
        generation.no_speech_threshold = None
        long_generation = copy.deepcopy(generation)
        long_generation.return_timestamps = True
        policy = {
            "decode": PCM_POLICY, "channel_policy": "arithmetic mean float32",
            "resample": "scipy.signal.resample_poly; exact gcd ratio to 16000Hz; kaiser5; constant padding",
            "short": "<=480000 samples; batch pad to 30s; truncation=False; attention mask",
            "long": ">480000 samples; singleton full features; padding=longest; truncation=False; Whisper native sequential timestamp long-form generation",
            "long_condition_on_prev_tokens": False, "silence_skipping": False,
            "temperature_fallback": False, "technical_failure": "atomic errors report, raise, resume unfinished IDs",
        }
        signature_payload = {
            "schema_version": 1, "source": cfg["source"], "official_split": records[0]["split"],
            "split_name": split_name, "mode": cfg["mode"],
            "asr_model_processor": {key: model_info[key] for key in ("repo_id", "revision", "hashes")},
            "short_generation_config": generation.to_dict(), "long_generation_config": long_generation.to_dict(),
            "audio_policy": policy, "precision": cfg["precision"], "device": cfg["device"],
            "environment": {key: cfg["environment"][key] for key in
                            ("python", "libraries", "cuda", "gpu", "compute_capability", "precision", "nvml")},
            "seed": cfg["seed"], "batch_size": cfg["asr_batch_size"],
            "code_sha256": sha256_file(Path(__file__)),
            "input_manifest_signature": signature([_record_identity(r) for r in records]),
        }
        asr_signature = signature(signature_payload)
        cache_dir = _namespace(cfg) / "asr_cache" / asr_signature / split_name
        cache_path = cache_dir / "records.jsonl"
        with _lock(cache_dir / ".writer.lock"):
            _immutable_json(cache_dir / "signature.json", {"asr_signature": asr_signature, **signature_payload})
            cached = {}
            for row in read_jsonl(cache_path):
                identifier = row["id"]
                if identifier in cached or identifier not in expected:
                    raise ValueError(f"Duplicate/foreign cache ID: {identifier}")
                if row.get("asr_signature") != asr_signature or row.get("status") != "ok":
                    raise ValueError(f"Invalid cache signature/status: {identifier}")
                if _record_identity(row) != _record_identity(expected[identifier]) or not isinstance(row.get("hypothesis_text"), str):
                    raise ValueError(f"Cache source/reference/audio identity differs: {identifier}")
                cached[identifier] = row
            # Hash the exported audio even for resumed IDs, without repeating model generation.
            for record in records:
                if record["id"] in cached:
                    _asr_audio(cfg, record)
            pending_short = [r for r in records if r["id"] not in cached and r["duration"] <= 30]
            pending_long = [r for r in records if r["id"] not in cached and r["duration"] > 30]
            batch_size = int(cfg["asr_batch_size"])
            if batch_size < 1:
                raise ValueError("asr_batch_size must be positive")
            batches = [(pending_short[i:i + batch_size], False) for i in range(0, len(pending_short), batch_size)]
            batches.extend(([record], True) for record in pending_long)
            error_path = cache_dir / "errors.json"
            errors = read_json(error_path).get("errors", []) if error_path.exists() else []
            for batch, long_form in batches:
                import time
                started = time.monotonic()
                try:
                    waveforms = [_asr_audio(cfg, r) for r in batch]
                    if any((len(wave) > 480000) != long_form for wave in waveforms):
                        raise ValueError("Audited duration and resampled long-form classification differ")
                    features = processor.feature_extractor(
                        waveforms, sampling_rate=16000, return_tensors="pt", return_attention_mask=True,
                        truncation=False, padding="longest" if long_form else "max_length",
                    )
                    kwargs = {"input_features": features.input_features.to(cfg["device"], dtype=dtype),
                              "attention_mask": features.attention_mask.to(cfg["device"]),
                              "generation_config": long_generation if long_form else generation,
                              "temperature": 0.0, "condition_on_prev_tokens": False}
                    if long_form:
                        kwargs["return_segments"] = True
                    with torch.inference_mode():
                        generated = model.generate(**kwargs)
                    sequences = generated["sequences"] if isinstance(generated, dict) else generated
                    hypotheses = processor.batch_decode(sequences, skip_special_tokens=True)
                    if len(hypotheses) != len(batch) or any(not isinstance(h, str) for h in hypotheses):
                        raise ValueError("ASR returned incomplete/malformed batch")
                    torch.cuda.synchronize()
                    batch_seconds = time.monotonic() - started
                    updates = []
                    for record, hypothesis in zip(batch, hypotheses, strict=True):
                        updates.append({**record, "hypothesis_text": hypothesis, "asr_signature": asr_signature,
                                        "status": "ok", "audio_policy": "native_long_form" if long_form else "batched_short",
                                        "hypothesis_empty": not bool(normalize_for_scoring(hypothesis)),
                                        "asr_seconds": batch_seconds / len(batch)})
                    next_cache = {**cached, **{row["id"]: row for row in updates}}
                    write_jsonl(cache_path, [next_cache[r["id"]] for r in records if r["id"] in next_cache])
                    cached = next_cache
                    print(f"ASR {split_name}: {len(cached)}/{len(expected)} ({batch_seconds:.2f}s/batch)", flush=True)
                    write_json(cache_dir / "coverage.json", {
                        "asr_signature": asr_signature, "expected": len(expected), "completed": len(cached),
                        "missing_ids": [r["id"] for r in records if r["id"] not in cached], "complete": len(cached) == len(expected),
                        "empty_hypothesis_ids": sorted(k for k, row in cached.items() if row["hypothesis_empty"]),
                        "records_sha256": sha256_file(cache_path),
                    })
                except Exception as error:
                    errors.append({"ids": [r["id"] for r in batch], "error_type": type(error).__name__, "message": str(error)})
                    write_json(cache_dir / "errors.json", {"asr_signature": asr_signature, "errors": errors})
                    write_json(cache_dir / "coverage.json", {
                        "asr_signature": asr_signature, "expected": len(expected), "completed": len(cached),
                        "missing_ids": [r["id"] for r in records if r["id"] not in cached], "complete": False,
                    })
                    raise RuntimeError(f"ASR infrastructure failure; progress retained at {cache_dir}") from error
            if set(cached) != set(expected):
                raise RuntimeError("ASR technical coverage incomplete")
            write_json(cache_dir / "errors.json", {"asr_signature": asr_signature, "errors": errors, "resolved": True})
            write_json(cache_dir / "coverage.json", {
                "asr_signature": asr_signature, "expected": len(expected), "completed": len(cached),
                "missing_ids": [], "complete": True,
                "empty_hypothesis_ids": sorted(k for k, row in cached.items() if row["hypothesis_empty"]),
                "records_sha256": sha256_file(cache_path),
            })
            write_json(_namespace(cfg) / "manifests" / f"asr_{split_name}.json", {
                "asr_signature": asr_signature, "cache_path": str(cache_path),
                "signature_path": str(cache_dir / "signature.json"), "coverage_path": str(cache_dir / "coverage.json"),
                "records_sha256": sha256_file(cache_path), "count": len(cached),
            })
            return [cached[r["id"]] for r in records]
    finally:
        del model
        release_gpu()


def _alignment_units(source, target):
    """Unit-cost Levenshtein alignment, deterministic diagonal/deletion/insertion ties."""
    previous = list(range(len(target) + 1))
    trace = [bytearray([2] * (len(target) + 1))]
    for i, left in enumerate(source, 1):
        current = [i]
        directions = bytearray(len(target) + 1)
        directions[0] = 1
        for j, right in enumerate(target, 1):
            costs = (previous[j - 1] + (left.strip() != right.strip()), previous[j] + 1, current[j - 1] + 1)
            best = min(costs)
            directions[j] = costs.index(best)
            current.append(best)
        trace.append(directions)
        previous = current
    i, j, aligned = len(source), len(target), []
    while i or j:
        direction = trace[i][j]
        if i and j and direction == 0:
            i -= 1
            j -= 1
            aligned.append((source[i], target[j]))
        elif i and (not j or direction == 1):
            i -= 1
            aligned.append((source[i], ""))
        else:
            j -= 1
            aligned.append(("", target[j]))
    return aligned[::-1]


def _token_lengths(tokenizer, source, target):
    inputs = tokenizer(source, add_special_tokens=True, truncation=False)["input_ids"]
    labels = tokenizer(text_target=target, add_special_tokens=True, truncation=False)["input_ids"]
    return len(inputs), len(labels)


def _aligned_windows(source, target, tokenizer, source_limit, target_limit):
    lengths = _token_lengths(tokenizer, source, target)
    if lengths[0] <= source_limit and lengths[1] <= target_limit:
        return [(source, target, [0, len(source)], [0, len(target)], lengths)]
    units = _alignment_units(re.findall(r"\S+\s*", source), re.findall(r"\S+\s*", target))
    windows = []

    def partition(aligned, source_start, target_start):
        left = "".join(a for a, _ in aligned)
        right = "".join(b for _, b in aligned)
        token_lengths = _token_lengths(tokenizer, left.strip(), right.strip())
        if token_lengths[0] <= source_limit and token_lengths[1] <= target_limit:
            windows.append((left.strip(), right.strip(), [source_start, source_start + len(left)],
                            [target_start, target_start + len(right)], token_lengths))
            return
        if len(aligned) <= 1:
            # A pathological single lexical token is split by its joint character alignment.
            expanded = _alignment_units(list(left), list(right))
            if len(expanded) <= 1:
                raise ValueError("Tokenizer cannot represent one aligned character within configured limits")
            aligned = expanded
        middle = len(aligned) // 2
        prefix = aligned[:middle]
        partition(prefix, source_start, target_start)
        partition(aligned[middle:], source_start + sum(len(a) for a, _ in prefix),
                  target_start + sum(len(b) for _, b in prefix))

    partition(units, 0, 0)
    if "".join(source[a:b] for _, _, (a, b), _, _ in windows) != source:
        raise AssertionError("Source window alignment is not lossless")
    if "".join(target[a:b] for _, _, _, (a, b), _ in windows) != target:
        raise AssertionError("Target window alignment is not lossless")
    return windows


def build_pairs(cfg, train_records, tokenizer):
    """Keep every eligible real pair, deduplicated identity views, and aligned long rows."""
    _verify_records(cfg, train_records)
    if any(r["split"] != "train" for r in train_records):
        raise ValueError("Only official train can supply correction supervision")
    eligible = sorted((r for r in train_records if not r["duplicate_excluded"]), key=lambda r: r["id"])
    if not eligible:
        raise ValueError("No eligible train records")
    selected_train = read_jsonl(_namespace(cfg) / "manifests" / "train_selected.jsonl")
    if {r["id"] for r in eligible} != {r["id"] for r in selected_train if not r["duplicate_excluded"]}:
        raise ValueError("Training inputs omit eligible parents from selected train manifest")
    for record in eligible:
        if record.get("status") != "ok" or not isinstance(record.get("hypothesis_text"), str) or not record.get("asr_signature"):
            raise ValueError(f"Training record lacks successful ASR provenance: {record['id']}")
    signatures = {r["asr_signature"] for r in eligible}
    if len(signatures) != 1:
        raise ValueError("Training pairs may not mix ASR signatures")
    source_limit, target_limit = int(cfg["max_source_tokens"]), int(cfg["max_target_tokens"])
    if not 0 < source_limit <= 512 or not 0 < target_limit <= 512:
        raise ValueError("R3 source and target token limits must be in [1,512]")
    identities = defaultdict(list)
    views = []
    for record in eligible:
        source = normalize_text(record["hypothesis_text"])
        target = normalize_text(record["reference_text"])
        views.append(("real", [record], source, target))
        identities[target].append(record)
    for target, parents in sorted(identities.items()):
        views.append(("identity", parents, target, target))
    pairs, length_audit = [], []
    for pair_type, parents, source, target in views:
        parent = parents[0]
        parent_ids = [r["id"] for r in parents]
        original_lengths = _token_lengths(tokenizer, source, target)
        windows = _aligned_windows(source, target, tokenizer, source_limit, target_limit)
        view_id = signature({"type": pair_type, "parents": parent_ids, "input": source, "target": target,
                             "asr_signature": parent["asr_signature"]})
        length_audit.append({"view_id": view_id, "pair_type": pair_type, "parent_ids": parent_ids,
                             "source_tokens": original_lengths[0], "target_tokens": original_lengths[1],
                             "windows": len(windows), "windowed": len(windows) > 1})
        for index, (left, right, source_span, target_span, lengths) in enumerate(windows):
            pairs.append({
                "pair_id": f"{pair_type}:{view_id}:{index:04d}", "parent_id": parent["id"], "parent_ids": parent_ids,
                "split": "train", "source_revision": parent["source_revision"], "pair_type": pair_type,
                "input_text": left, "target_text": right,
                "is_errorful": normalize_for_scoring(left) != normalize_for_scoring(right),
                "window_index": index, "window_count": len(windows), "asr_signature": parent["asr_signature"],
                "input_span": source_span, "target_span": target_span,
                "source_tokens": lengths[0], "target_tokens": lengths[1],
                "parent_input_text": source, "parent_target_text": target,
                "raw_parent_texts": [{"id": r["id"], "reference_text": r["reference_text"],
                                      "hypothesis_text": r["hypothesis_text"]} for r in parents],
                "review_state": "upstream_reference_unadjudicated",
            })
    real_parents = {p["parent_id"] for p in pairs if p["pair_type"] == "real"}
    identity_parents = {identifier for p in pairs if p["pair_type"] == "identity" for identifier in p["parent_ids"]}
    if real_parents != {r["id"] for r in eligible} or identity_parents != real_parents:
        raise AssertionError("Pair parent coverage incomplete")
    if len({p["pair_id"] for p in pairs}) != len(pairs):
        raise AssertionError("Duplicate pair IDs")
    base = _namespace(cfg) / "pairs"
    pair_signature = signature({
        "source": cfg["source"], "correction_model_tokenizer": cfg["models"]["correction"],
        "asr_signatures": sorted(signatures), "limits": [source_limit, target_limit], "pairs": pairs,
        "normalization": "NFC+whitespace only; scoring normalization exclusively for error labels",
        "window_policy": "joint word Levenshtein; recursive aligned midpoint; character alignment for oversized lexical unit",
    })
    destination = base / pair_signature
    _immutable_jsonl(destination / "train.jsonl", pairs)
    _immutable_jsonl(destination / "length_audit.jsonl", length_audit)
    counts = Counter(p["pair_type"] for p in pairs)
    stats = {
        "pair_signature": pair_signature, "mode": cfg["mode"], "source_revision": cfg["source"]["revision"],
        "asr_signatures": sorted(signatures), "input_record_count": len(train_records), "eligible_parent_count": len(eligible),
        "excluded_duplicate_ids": sorted(r["id"] for r in train_records if r["duplicate_excluded"]),
        "pair_count": len(pairs), "pair_type_counts": dict(counts), "identity_unique_views": len(identities),
        "identity_dedup_removed_views": len(eligible) - len(identities),
        "windowed_views": sum(a["windowed"] for a in length_audit), "errorful_pairs": sum(p["is_errorful"] for p in pairs),
        "real_errorful_parents": sum(normalize_for_scoring(r["hypothesis_text"]) != normalize_for_scoring(r["reference_text"]) for r in eligible),
        "source_token_max": max(p["source_tokens"] for p in pairs), "target_token_max": max(p["target_tokens"] for p in pairs),
        "source_token_total": sum(p["source_tokens"] for p in pairs), "target_token_total": sum(p["target_tokens"] for p in pairs),
        "empty_input_pairs": sum(not p["input_text"] for p in pairs), "empty_target_pairs": sum(not p["target_text"] for p in pairs),
        "pairs_path": str(destination / "train.jsonl"), "pairs_sha256": sha256_file(destination / "train.jsonl"),
        "length_audit_sha256": sha256_file(destination / "length_audit.jsonl"),
        "source_token_limit": source_limit, "target_token_limit": target_limit,
        "tokenizer": cfg["models"]["correction"], "raw_text_preserved": True,
        "window_policy": "joint Levenshtein alignment; aligned midpoint partitions; exact parent character spans",
    }
    _immutable_json(destination / "manifest.json", stats)
    write_json(base / "manifest.json", stats)
    return pairs
