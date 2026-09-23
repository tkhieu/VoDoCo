#!/usr/bin/env python3
"""Package pinned, local inference assets without loading models or touching sources."""

import argparse
import copy
import json
import os
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "services/inference/src"))
from vodoco_inference.artifacts import (  # noqa: E402
    asset_path, canonical_hash, read_manifest, sha256_file, validate_labels, verify_model,
)
from vodoco_inference.errors import InferenceError  # noqa: E402

SELECTED_EXPORT = "seed_123_lr3e-05_ep8_wd0.05"
ZIP_ROOT = f"content/phobert-vietmed-ner/{SELECTED_EXPORT}/"
PHOBERT_ASSETS = frozenset({
    "model.safetensors", "config.json", "tokenizer_config.json", "vocab.txt",
    "bpe.codes", "added_tokens.json", "special_tokens_map.json",
})
VIHEALTHBERT_ID = "vihealthbert-ner-seed2024"
VIHEALTHBERT_ASSETS = PHOBERT_ASSETS
IGNORED_TRAINING = frozenset({"training_args.bin"})
CHECKPOINT_ASSETS = PHOBERT_ASSETS | IGNORED_TRAINING | {
    "scheduler.pt", "trainer_state.json", "optimizer.pt", "rng_state.pth",
}
MAX_ARCHIVE = 2 * 1024**3
MAX_MEMBER = 1200 * 1024**2
MAX_EXPANDED = 3 * 1024**3
MAX_RUNTIME_ASSET = 600 * 1024**2


def zip_members(archive: zipfile.ZipFile) -> dict:
    entries = archive.infolist()
    if len(entries) > 128 or sum(item.file_size for item in entries) > MAX_EXPANDED:
        raise ValueError("Archive exceeds bounded export limits")
    selected = {}
    seen = set()
    for item in entries:
        name = item.filename
        bare = name.rstrip("/")
        parts = PurePosixPath(bare)
        mode = item.external_attr >> 16
        if (name in seen or "\\" in name or "\x00" in name or parts.is_absolute()
                or any(part in {"", ".", ".."} for part in bare.split("/"))
                or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR})
                or item.flag_bits & 1):
            raise ValueError("Unsafe archive member")
        seen.add(name)
        if item.file_size > MAX_MEMBER or (item.file_size and item.file_size / max(item.compress_size, 1) > 1000):
            raise ValueError("Archive expansion exceeds limits")
        if not name.startswith(ZIP_ROOT):
            raise ValueError("Archive does not contain only the exact selected export")
        relative = name[len(ZIP_ROOT):]
        if item.is_dir():
            if relative not in {"", "checkpoint-2023/"}:
                raise ValueError("Unexpected export directory")
            continue
        if relative in PHOBERT_ASSETS:
            if item.file_size > MAX_RUNTIME_ASSET:
                raise ValueError("Runtime asset exceeds size limit")
            selected[relative] = item
        elif relative in IGNORED_TRAINING:
            continue
        elif relative.startswith("checkpoint-2023/") and relative.split("/", 1)[1] in CHECKPOINT_ASSETS:
            # Metadata inspection only: never open checkpoint/pickle members.
            continue
        else:
            raise ValueError("Unexpected export member")
    if set(selected) != PHOBERT_ASSETS:
        raise ValueError("Selected root export is missing runtime assets")
    return selected


def copy_bounded(source, destination: Path, limit: int) -> None:
    count = 0
    with destination.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            if count > limit:
                raise ValueError("Runtime asset exceeds size limit")
            target.write(chunk)


def prepare_phobert(args, destination: Path) -> None:
    destination.mkdir()
    if args.phobert_zip:
        source = args.phobert_zip
        if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_ARCHIVE:
            raise ValueError("Invalid selected export archive")
        with zipfile.ZipFile(source) as archive:
            for name, item in zip_members(archive).items():
                with archive.open(item) as stream:
                    copy_bounded(stream, destination / name, MAX_RUNTIME_ASSET)
    else:
        source = args.phobert_dir
        if source.is_symlink() or not source.is_dir():
            raise ValueError("Select the exact seed-123 export directory")
        for name in PHOBERT_ASSETS:
            path = asset_path(source, name)
            if not path.is_file():
                raise ValueError("Selected export is missing a runtime asset")
            with path.open("rb") as stream:
                copy_bounded(stream, destination / name, MAX_RUNTIME_ASSET)


def prepare_vihealthbert(args, destination: Path) -> None:
    source = args.vihealthbert_dir
    if source.name != VIHEALTHBERT_ID or source.is_symlink() or not source.is_dir():
        raise ValueError("Select the exact ViHealthBERT export directory")
    entries = list(source.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError("ViHealthBERT export contains an unsupported entry")
    names = {path.name for path in entries}
    if not VIHEALTHBERT_ASSETS <= names or names - VIHEALTHBERT_ASSETS - IGNORED_TRAINING:
        raise ValueError("ViHealthBERT export does not match the runtime asset allowlist")
    destination.mkdir()
    for name in VIHEALTHBERT_ASSETS:
        with (source / name).open("rb") as stream:
            copy_bounded(stream, destination / name, MAX_RUNTIME_ASSET)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    selected = parser.add_mutually_exclusive_group(required=True)
    selected.add_argument("--phobert-zip", type=Path)
    selected.add_argument("--phobert-dir", type=Path)
    parser.add_argument("--vihealthbert-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=REPO / ".local/vodoco-models/release")
    parser.add_argument("--manifest", type=Path, default=REPO / "services/inference/model-manifest.json")
    parser.add_argument("--asr-root", type=Path,
                        help="Pinned snapshot root containing asr/whisper-small-vietnamese")
    parser.add_argument("--xlmr-dir", type=Path, help="Pinned xlm-roberta-base-VietMed-NER directory")
    parser.add_argument("--source-attestation", help="Optional owner-provided artifact provenance statement")
    args = parser.parse_args(argv)
    staging = None
    try:
        if args.output.exists() or args.output.is_symlink():
            raise ValueError("Output already exists; choose a new release directory")
        manifest = copy.deepcopy(read_manifest(args.manifest))
        snapshots = json.loads((REPO / "datasets/derived/correction/manifests/model-snapshots.json").read_text())
        sources = {
            "asr": args.asr_root or REPO / "experiments/002-vietmed-correction-training/models/sources/asr" / snapshots["asr"]["revision"],
            "xlmr": args.xlmr_dir or REPO / "experiments/002-vietmed-correction-training/models/sources/ner" / snapshots["ner"]["revision"] / "xlm-roberta-base-VietMed-NER",
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".prepare-", dir=args.output.parent))
        for model_id, snapshot_id in (("asr", "asr"), ("xlmr", "ner")):
            spec = manifest["models"][model_id]
            recorded = snapshots[snapshot_id]
            if spec["revision"] != recorded["revision"] or spec["repo_id"] != recorded["repo_id"]:
                raise ValueError("Pinned source identity differs from release specification")
            expected = {f"{model_id}/{name}": digest for name, digest in recorded["hashes"].items()}
            if spec["files"] != expected:
                raise ValueError("Release hashes differ from recorded pinned snapshot")
            for name, digest in recorded["hashes"].items():
                source = asset_path(sources[model_id], name)
                target = asset_path(staging, f"{model_id}/{name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                # Copy then hash the actual packaged bytes, not a mutable source's earlier state.
                with source.open("rb") as stream:
                    copy_bounded(stream, target, 2 * 1024**3)
                if sha256_file(target) != digest:
                    raise ValueError(f"Pinned {model_id} artifact checksum mismatch")
        prepare_phobert(args, staging / "phobert")
        prepare_vihealthbert(args, staging / VIHEALTHBERT_ID)
        for model_id, assets in (("phobert", PHOBERT_ASSETS),
                                 (VIHEALTHBERT_ID, VIHEALTHBERT_ASSETS)):
            spec = manifest["models"][model_id]
            config = json.loads((staging / model_id / "config.json").read_text())
            labels = validate_labels(config)
            if labels != spec["id2label"] or canonical_hash(labels) != spec["label_map_sha256"]:
                raise ValueError(f"Selected {model_id} label map does not match the recorded export")
            if config.get("model_type") != "roberta" or config.get("tokenizer_class") != "PhobertTokenizer":
                raise ValueError(f"Selected {model_id} export is not the expected classifier")
            computed_files = {f"{model_id}/{name}": sha256_file(staging / model_id / name)
                              for name in sorted(assets)}
            if spec["files"] and computed_files != spec["files"]:
                raise ValueError(f"Selected {model_id} assets differ from the pinned release")
            spec["files"] = computed_files
            spec["checkpoint_sha256"] = spec["files"][f"{model_id}/model.safetensors"]
        if args.phobert_zip:
            manifest["provenance"]["phobert_archive_sha256"] = sha256_file(args.phobert_zip)
        if args.source_attestation:
            manifest["provenance"]["artifact_attestation"] = args.source_attestation
        for model_id, model_spec in manifest["models"].items():
            verify_model(staging, model_id, model_spec)
        content = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        (staging / "manifest.json").write_text(content, encoding="utf-8")
        # No source modifications; only the generated release and requested manifest.
        os.rename(staging, args.output)
        staging = None
        args.manifest.write_text(content, encoding="utf-8")
        print(json.dumps({"status": "prepared", "models": {
            model_id: {"checkpoint_sha256": spec["checkpoint_sha256"],
                       "label_map_sha256": spec["label_map_sha256"], "assets": len(spec["files"])}
            for model_id, spec in manifest["models"].items()
        }}, indent=2))
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, RuntimeError, InferenceError) as exc:
        # Operator CLI reports a category without dumping private local paths.
        print(json.dumps({"status": "failed", "error": type(exc).__name__,
                          "message": "Model preparation failed; check selected export, pinned assets and output permissions."}), file=sys.stderr)
        return 1
    finally:
        if staging is not None:
            shutil.rmtree(staging)


if __name__ == "__main__":
    raise SystemExit(main())
