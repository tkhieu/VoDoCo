"""Shared deterministic IO and correction runtime for experiment 002."""
from __future__ import annotations

import contextlib
import gc
import hashlib
import importlib.util
import json
import os
import random
import re
import tempfile
import unicodedata
from pathlib import Path

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "historical_scoring_normalization",
    ROOT / "experiments/001-zeroshot-correction-vietmed/scripts/text-normalization-utils.py",
)
_normalizer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_normalizer)
normalize_for_scoring = _normalizer.normalize_for_scoring


def _json_default(value):
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"Not JSON serializable: {type(value)!r}")


def signature(value):
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False, default=_json_default)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False, allow_nan=False,
                      default=_json_default)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, allow_nan=False,
                                        default=_json_default) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def normalize_text(text):
    if not isinstance(text, str):
        raise TypeError("Training/inference text must be a string")
    return " ".join(unicodedata.normalize("NFC", text).split())


def seed_everything(seed):
    import numpy as np
    import torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.set_num_threads(min(8, os.cpu_count() or 1))


def release_gpu():
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def autocast_context(cfg):
    import torch
    if cfg["device"] == "cuda":
        dtype = torch.bfloat16 if cfg["precision"] == "bf16" else torch.float16
        return torch.autocast(device_type="cuda", dtype=dtype)
    return contextlib.nullcontext()


def load_corrector(cfg, adapter_path=None):
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    import torch
    path = cfg["models"]["correction"]["path"]
    tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        path, local_files_only=True, torch_dtype=torch.float32,
        attn_implementation="sdpa",
    ).to(cfg["device"])
    if adapter_path is not None:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, str(adapter_path), is_trainable=False)
    model.eval()
    return model, tokenizer


def chunk_text(text, tokenizer, limit):
    """Lossless whitespace-boundary windows; no reference is available at inference."""
    text = normalize_text(text)
    if len(tokenizer(text)["input_ids"]) <= limit:
        return [text]
    words = text.split()
    result = []
    start = 0
    while start < len(words):
        low, high = start + 1, len(words)
        if len(tokenizer(words[start])["input_ids"]) > limit:
            raise ValueError("A lexical item exceeds the input limit; no content was truncated")
        while low < high:
            middle = (low + high + 1) // 2
            if len(tokenizer(" ".join(words[start:middle]))["input_ids"]) <= limit:
                low = middle
            else:
                high = middle - 1
        result.append(" ".join(words[start:low]))
        start = low
    return result


def generate_corrections(model, tokenizer, texts, cfg):
    """Generate all input content; deterministic length-bucketed batching."""
    import torch
    if not texts:
        return []
    chunks, owners = [], []
    for owner, text in enumerate(texts):
        for chunk in chunk_text(text, tokenizer, cfg["max_source_tokens"]):
            owners.append(owner)
            chunks.append(chunk)
    lengths = [len(tokenizer(text)["input_ids"]) for text in chunks]
    order = sorted(range(len(chunks)), key=lambda i: (lengths[i], i))
    generated = [None] * len(chunks)
    was_training = model.training
    previous_cache = model.config.use_cache
    model.eval()
    model.config.use_cache = True
    try:
        with torch.inference_mode(), autocast_context(cfg):
            for start in range(0, len(order), cfg["eval_batch_size"]):
                indices = order[start:start + cfg["eval_batch_size"]]
                batch = tokenizer([chunks[i] for i in indices], padding=True,
                                  truncation=False, return_tensors="pt").to(cfg["device"])
                if batch["input_ids"].shape[1] > cfg["max_source_tokens"]:
                    raise RuntimeError("Unaccounted correction input overflow")
                output = model.generate(**batch, **cfg["generation"])
                # Token cap exhaustion is observable, not a silently accepted crop.
                for tokens in output:
                    if tokens.numel() >= cfg["generation"]["max_new_tokens"] + 1:
                        eos = tokenizer.eos_token_id
                        if eos not in tokens[1:-1].tolist():
                            raise RuntimeError("Correction reached generation cap; protocol needs review")
                decoded = tokenizer.batch_decode(output, skip_special_tokens=True)
                for index, value in zip(indices, decoded, strict=True):
                    generated[index] = value
    finally:
        model.config.use_cache = previous_cache
        model.train(was_training)
    result = [[] for _ in texts]
    for owner, value in zip(owners, generated, strict=True):
        result[owner].append(value)
    return [normalize_text(" ".join(parts)) for parts in result]
