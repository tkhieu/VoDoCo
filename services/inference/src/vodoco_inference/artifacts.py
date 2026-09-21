"""Portable release manifests and strict runtime asset verification."""

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

from .errors import InferenceError

MODEL_IDS = ("asr", "phobert", "xlmr")
BACKGROUND_LABELS = frozenset({"0", "O", "dum"})
ENTITY_LABELS = frozenset({
    "AGE", "DATETIME", "DIAGNOSTICS", "DISEASESYMTOM", "DRUGCHEMICAL",
    "FOODDRINK", "GENDER", "LOCATION", "MEDDEVICETECHNIQUE", "OCCUPATION",
    "ORGAN", "ORGANIZATION", "PERSONALCARE", "PREVENTIVEMED", "SURGERY",
    "TRANSPORTATION", "TREATMENT", "UNITCALIBRATOR",
})


def sha256_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def canonical_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def asset_path(root: Path, relative: str) -> Path:
    parts = PurePosixPath(relative)
    if (not relative or "\\" in relative or parts.is_absolute()
            or any(part in {"", ".", ".."} for part in relative.split("/"))):
        raise ValueError("Invalid relative model asset")
    root = root.resolve()
    candidate = root.joinpath(*parts.parts)
    # No symlinks in the bundle: no asset may redirect after verification.
    current = root
    for part in parts.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink model asset rejected")
    if not candidate.resolve().is_relative_to(root):
        raise ValueError("Model asset escapes release")
    return candidate


def validate_labels(config: dict) -> dict:
    labels = {str(int(key)): value for key, value in config["id2label"].items()}
    if set(labels) != {str(index) for index in range(len(labels))}:
        raise ValueError("Non-contiguous classifier labels")
    expected = {f"{prefix}-{label}" for prefix in ("B", "I") for label in ENTITY_LABELS}
    values = set(labels.values())
    if values - BACKGROUND_LABELS != expected or not values & BACKGROUND_LABELS:
        raise ValueError("Unexpected VietMed classifier vocabulary")
    if len(values) != len(labels):
        raise ValueError("Duplicate classifier labels")
    if config.get("label2id") != {label: int(key) for key, label in labels.items()}:
        raise ValueError("Classifier label maps disagree")
    return labels


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or set(manifest.get("models", {})) != set(MODEL_IDS):
        raise ValueError("Unsupported model manifest")
    if manifest.get("correction") is not False:
        raise ValueError("Correction must be disabled")
    return manifest


def verify_model(root: Path, model_id: str, spec: dict) -> None:
    try:
        files = spec["files"]
        if not files or set(files) != set(spec["required_assets"]):
            raise ValueError("Incomplete manifest hashes")
        for relative, digest in files.items():
            if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
                raise ValueError("Invalid asset hash")
            path = asset_path(root, relative)
            if not path.is_file():
                raise FileNotFoundError
            if sha256_file(path) != digest:
                raise ValueError("Model asset hash mismatch")
        config = json.loads(asset_path(root, spec["model_path"]).joinpath("config.json").read_text())
        if model_id != "asr":
            labels = validate_labels(config)
            if labels != spec["id2label"] or canonical_hash(labels) != spec["label_map_sha256"]:
                raise ValueError("Classifier manifest mismatch")
            if spec["token_limit"] != 256:
                raise ValueError("Unexpected NER token limit")
        if files[spec["weight_path"]] != spec["checkpoint_sha256"]:
            raise ValueError("Checkpoint manifest mismatch")
    except FileNotFoundError as exc:
        raise InferenceError("MODEL_MISSING", "Required model assets are unavailable.",
                             "loading", model_id) from exc
    except (ValueError, KeyError, TypeError, OSError) as exc:
        raise InferenceError("MODEL_INTEGRITY", "Model artifact verification failed.",
                             "loading", model_id) from exc
