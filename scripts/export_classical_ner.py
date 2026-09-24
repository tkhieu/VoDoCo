#!/usr/bin/env python3
"""Train/evaluate the classical models; direct CLI output is a classical-only artifact set.

The deployable seven-model release is assembled by ``prepare_demo_models.py``.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "services/inference/src"))

from vodoco_inference.artifacts import canonical_hash, sha256_file, verify_model  # noqa: E402
from vodoco_inference.classical import (  # noqa: E402
    CLASSICAL_TOKEN_LIMIT,
    CrfPredictor,
    LinearPredictor,
    featurize,
)

DATASET_REPO = "leduckhai/VietMed-NER"
DATASET_REVISION = "e3d0393c733858402a7c04228f45d351d2ce6d8f"
CLASSICAL_ORDER = ("logreg", "linear-svm", "crf")
DATASET_SHA256 = {
    "train": "5d04692de75257c5392ad7a1b4cc4fbdd078f4b454719dbae46b89d284452a3c",
    "validation": "bf1caebca2d49d6f2fb91bfb7297d32b083be87a31fb64cadf05b6eadcbd80ed",
    "test": "fd9c5e5778ded8d01512e1acf19c4e75a788c861d43299683e16d13a2b05228a",
}
DISPLAY_NAMES = {
    "logreg": "Logistic Regression",
    "linear-svm": "Linear SVM",
    "crf": "CRF",
}
TOKENIZER_IDENTITY = "ClassicalTokenizerV1: whitespace, NFC, lowercase, Unicode punctuation trim"
F1_TOLERANCE = 0.0005  # 0.05 percentage point


def normalize_label(label: object) -> str:
    return "O" if str(label) in {"0", "O"} else str(label)


def resolve_dataset(dataset_dir: Path | None) -> Path:
    candidate = dataset_dir or REPO / "do_an_may_hoc/data/vietmed-ner"
    if candidate.exists():
        return candidate.resolve()
    from huggingface_hub import snapshot_download

    destination = REPO / ".local/vodoco-datasets" / DATASET_REVISION
    snapshot_download(
        DATASET_REPO,
        repo_type="dataset",
        revision=DATASET_REVISION,
        allow_patterns=["data/*.parquet"],
        local_dir=destination,
    )
    return destination


def load_data(dataset_dir: Path) -> dict[str, tuple[list[list[str]], list[list[str]]]]:
    import pyarrow.parquet as pq

    data_dir = dataset_dir / "data" if (dataset_dir / "data").is_dir() else dataset_dir
    result = {}
    for split in ("train", "validation", "test"):
        matches = list(data_dir.glob(f"{split}-*.parquet"))
        if len(matches) != 1:
            raise ValueError(f"Expected one parquet file for {split}")
        if sha256_file(matches[0]) != DATASET_SHA256[split]:
            raise ValueError(f"Dataset file hash differs from pinned {split} split")
        table = pq.read_table(matches[0], columns=["words", "labels"]).to_pydict()
        words = [[str(word) for word in sentence] for sentence in table["words"]]
        labels = [[normalize_label(label) for label in sentence] for sentence in table["labels"]]
        if len(words) != len(labels) or any(len(sentence) != len(tags) for sentence, tags in zip(words, labels)):
            raise ValueError("Dataset words and labels disagree")
        result[split] = words, labels
    return result


def flatten(rows: list[list[str]]) -> list[str]:
    return [item for row in rows for item in row]


def unflatten(values, sentences: list[list[str]]) -> list[list[str]]:
    output = []
    offset = 0
    for sentence in sentences:
        output.append([str(value) for value in values[offset:offset + len(sentence)]])
        offset += len(sentence)
    if offset != len(values):
        raise ValueError("Prediction shape disagrees with sentences")
    return output


def label_maps(classes) -> tuple[dict[str, str], dict[str, int]]:
    names = [str(label) for label in classes]
    return ({str(index): label for index, label in enumerate(names)},
            {label: index for index, label in enumerate(names)})


def write_json(path: Path, value: object, *, compact: bool = False) -> None:
    content = json.dumps(value, ensure_ascii=False, sort_keys=compact,
                         separators=(",", ":") if compact else None,
                         indent=None if compact else 2) + "\n"
    path.write_text(content, encoding="utf-8")


def model_spec(model_id: str, directory: Path, output_root: Path, weight_name: str,
               id2label: dict[str, str], metrics: dict[str, float], artifact_type: str,
               dtype: str) -> dict:
    relative_dir = directory.relative_to(output_root).as_posix()
    assets = sorted(path.name for path in directory.iterdir() if path.is_file())
    files = {f"{relative_dir}/{name}": sha256_file(directory / name) for name in assets}
    weight_path = f"{relative_dir}/{weight_name}"
    return {
        "repo_id": DATASET_REPO,
        "revision": DATASET_REVISION,
        "source_subfolder": "data",
        "source": "Team-trained from the pinned VietMed-NER train split",
        "model_path": relative_dir,
        "weight_path": weight_path,
        "checkpoint_sha256": files[weight_path],
        "tokenizer_identity": TOKENIZER_IDENTITY,
        "token_limit": CLASSICAL_TOKEN_LIMIT,
        "id2label": id2label,
        "label_map_sha256": canonical_hash(id2label),
        "dtype": dtype,
        "artifact_type": artifact_type,
        "evaluation": metrics,
        "required_assets": list(files),
        "files": files,
    }


def verify_expected(metrics: dict[str, dict[str, float]], benchmark_path: Path) -> None:
    benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))["models"]
    for model_id, values in metrics.items():
        source = benchmark[DISPLAY_NAMES[model_id]]
        expected = {
            "validation_f1": float(source["val_f1"]),
            "test_f1": float(source["test_f1"]),
        }
        if any(abs(values[name] - target) > F1_TOLERANCE for name, target in expected.items()):
            raise ValueError(f"{model_id} validation/test F1 differs from the recorded benchmark")


def export_models(dataset_dir: Path | None, output_root: Path, manifest: dict,
                  benchmark_path: Path) -> dict[str, dict[str, float]]:
    from seqeval.metrics import f1_score
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.svm import LinearSVC
    import sklearn_crfsuite

    output_root = output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    dataset = load_data(resolve_dataset(dataset_dir))
    features = {split: [featurize(sentence) for sentence in values[0]] for split, values in dataset.items()}
    vectorizer = DictVectorizer()
    matrices = {"train": vectorizer.fit_transform([item for row in features["train"] for item in row])}
    for split in ("validation", "test"):
        matrices[split] = vectorizer.transform([item for row in features[split] for item in row])
    for matrix in matrices.values():
        matrix.indices = matrix.indices.astype(np.int32)
        matrix.indptr = matrix.indptr.astype(np.int32)
    train_labels = flatten(dataset["train"][1])
    vocabulary = {str(name): int(index) for name, index in vectorizer.vocabulary_.items()}
    benchmark_path = benchmark_path.resolve()
    staging = Path(tempfile.mkdtemp(prefix=".classical-", dir=output_root))
    specs = {}
    metrics = {}
    try:
        linear_models = {
            "logreg": (LogisticRegression(C=10, max_iter=300), {"C": 10, "max_iter": 300}),
            "linear-svm": (LinearSVC(C=1, max_iter=5000), {"C": 1, "max_iter": 5000}),
        }
        for model_id, (classifier, hyperparameters) in linear_models.items():
            model_dir = staging / model_id
            model_dir.mkdir()
            classifier.fit(matrices["train"], train_labels)
            predictions = {
                split: unflatten(classifier.predict(matrix), dataset[split][1])
                for split, matrix in matrices.items()
            }
            measured = {
                "validation_f1": float(f1_score(dataset["validation"][1], predictions["validation"], zero_division=0)),
                "test_f1": float(f1_score(dataset["test"][1], predictions["test"], zero_division=0)),
            }
            id2label, label2id = label_maps(classifier.classes_)
            np.savez_compressed(
                model_dir / "model.npz",
                coef=np.asarray(classifier.coef_, dtype=np.float64),
                intercept=np.asarray(classifier.intercept_, dtype=np.float64),
                classes=np.asarray(classifier.classes_, dtype=np.str_),
            )
            write_json(model_dir / "features.json", {"schema_version": 1, "vocabulary": vocabulary}, compact=True)
            write_json(model_dir / "config.json", {
                "schema_version": 1,
                "model_id": model_id,
                "artifact_type": "linear-npz-v1",
                "id2label": id2label,
                "label2id": label2id,
                "hyperparameters": hyperparameters,
                "dataset": {"repo_id": DATASET_REPO, "revision": DATASET_REVISION, "train_split": "train"},
                "metrics": measured,
            })
            temporary_spec = {"model_path": model_dir.relative_to(output_root).as_posix(),
                              "weight_path": (model_dir / "model.npz").relative_to(output_root).as_posix()}
            reloaded = LinearPredictor.load(output_root, temporary_spec)
            reloaded_test = [reloaded.predict(sentence) for sentence in dataset["test"][0]]
            if reloaded_test != predictions["test"]:
                raise ValueError(f"Reloaded {model_id} predictions differ from the trained classifier")
            specs[model_id] = model_spec(model_id, model_dir, output_root, "model.npz", id2label,
                                         measured, "linear-npz-v1", "float64")
            metrics[model_id] = measured

        model_id = "crf"
        model_dir = staging / model_id
        model_dir.mkdir()
        weight_path = model_dir / "model.crfsuite"
        classifier = sklearn_crfsuite.CRF(
            algorithm="lbfgs", c1=0.1, c2=0.01, max_iterations=200,
            all_possible_transitions=True, model_filename=str(weight_path),
        )
        classifier.fit(features["train"], dataset["train"][1])
        predictions = {split: [[str(label) for label in row] for row in classifier.predict(rows)]
                       for split, rows in features.items()}
        measured = {
            "validation_f1": float(f1_score(dataset["validation"][1], predictions["validation"], zero_division=0)),
            "test_f1": float(f1_score(dataset["test"][1], predictions["test"], zero_division=0)),
        }
        classes = sorted(set(train_labels))
        id2label, label2id = label_maps(classes)
        write_json(model_dir / "config.json", {
            "schema_version": 1,
            "model_id": model_id,
            "artifact_type": "crfsuite-v1",
            "id2label": id2label,
            "label2id": label2id,
            "hyperparameters": {"algorithm": "lbfgs", "c1": 0.1, "c2": 0.01,
                                    "max_iterations": 200, "all_possible_transitions": True},
            "dataset": {"repo_id": DATASET_REPO, "revision": DATASET_REVISION, "train_split": "train"},
            "metrics": measured,
        })
        reloaded = CrfPredictor(weight_path)
        reloaded_test = [reloaded.predict(sentence) for sentence in dataset["test"][0]]
        if reloaded_test != predictions["test"]:
            raise ValueError("Reloaded CRF predictions differ from the trained classifier")
        specs[model_id] = model_spec(model_id, model_dir, output_root, "model.crfsuite", id2label,
                                     measured, "crfsuite-v1", "crfsuite")
        metrics[model_id] = measured

        verify_expected(metrics, benchmark_path)
        for model_id in CLASSICAL_ORDER:
            destination = output_root / model_id
            if destination.exists() or destination.is_symlink():
                raise ValueError("Classical export destination already exists")
            os.rename(staging / model_id, destination)
            spec = copy.deepcopy(specs[model_id])
            old_prefix = f"{staging.relative_to(output_root).as_posix()}/{model_id}"
            new_prefix = model_id
            for key in ("model_path", "weight_path"):
                spec[key] = spec[key].replace(old_prefix, new_prefix, 1)
            spec["required_assets"] = [path.replace(old_prefix, new_prefix, 1) for path in spec["required_assets"]]
            spec["files"] = {path.replace(old_prefix, new_prefix, 1): digest for path, digest in spec["files"].items()}
            manifest["models"][model_id] = spec
        ordered = {"asr": manifest["models"]["asr"]}
        ordered.update((model_id, manifest["models"][model_id]) for model_id in CLASSICAL_ORDER)
        ordered.update((model_id, manifest["models"][model_id])
                       for model_id in ("xlmr", "phobert", "vihealthbert-ner-seed2024"))
        manifest["models"] = ordered
        manifest.setdefault("provenance", {})["classical_models"] = (
            f"Team-trained from {DATASET_REPO} train split at revision {DATASET_REVISION}; "
            "safe runtime artifacts contain numeric arrays/JSON or native CRFsuite format, never pickle/joblib."
        )
        return metrics
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def atomic_write(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path)
    parser.add_argument("--output", type=Path, default=REPO / ".local/vodoco-models/classical-export")
    parser.add_argument("--manifest", type=Path, default=REPO / "services/inference/model-manifest.json")
    parser.add_argument("--benchmark", type=Path,
                        default=REPO / "do_an_may_hoc/results/model_comparison.json")
    args = parser.parse_args(argv)
    owned_output = False
    try:
        if not args.manifest.is_file():
            raise ValueError("Release manifest is unavailable")
        if args.output.exists() or args.output.is_symlink():
            raise ValueError("Output already exists; choose a fresh classical export directory")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        owned_output = True
        metrics = export_models(args.dataset_dir, args.output, manifest, args.benchmark)
        classical_models = {model_id: manifest["models"][model_id] for model_id in CLASSICAL_ORDER}
        for model_id, spec in classical_models.items():
            verify_model(args.output, model_id, spec)
        document = {
            "schema_version": 1,
            "artifact_set": "vodoco-classical-ner-v1",
            "dataset": {"repo_id": DATASET_REPO, "revision": DATASET_REVISION},
            "models": classical_models,
        }
        content = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        atomic_write(args.output / "classical-manifest.json", content)
        print(json.dumps({
            "status": "exported",
            "artifact_set": document["artifact_set"],
            "manifest": "classical-manifest.json",
            "dataset_revision": DATASET_REVISION,
            "models": metrics,
        }, ensure_ascii=False, indent=2))
        return 0
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, KeyError) as exc:
        if owned_output and args.output.exists() and not args.output.is_symlink():
            shutil.rmtree(args.output)
        print(json.dumps({"status": "failed", "error": type(exc).__name__,
                          "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
