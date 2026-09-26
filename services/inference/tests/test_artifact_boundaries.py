import importlib.util
import io
import json
import stat
import zipfile
from types import SimpleNamespace
from pathlib import Path

import pytest

from vodoco_inference.artifacts import (
    ENTITY_LABELS, asset_path, canonical_hash, sha256_file, validate_labels, verify_model,
)
from vodoco_inference.errors import InferenceError

SCRIPT = Path(__file__).resolve().parents[3] / "scripts/prepare_demo_models.py"
spec = importlib.util.spec_from_file_location("prepare_demo_models", SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def make_archive(extra=None, only_checkpoint=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name in prepare.PHOBERT_ASSETS:
            prefix = "checkpoint-2023/" if only_checkpoint else ""
            archive.writestr(prepare.ZIP_ROOT + prefix + name, b"asset")
        if extra is not None:
            archive.writestr(extra, b"unsafe")
    stream.seek(0)
    return zipfile.ZipFile(stream)


@pytest.mark.parametrize("name", [
    "../config.json",
    prepare.ZIP_ROOT + "../config.json",
    prepare.ZIP_ROOT + "extra.py",
    prepare.ZIP_ROOT + "checkpoint-9999/model.safetensors",
])
def test_archive_rejects_escape_unknown_members_and_other_checkpoints(name):
    with make_archive(name) as archive, pytest.raises(ValueError):
        prepare.zip_members(archive)


def test_checkpoint_cannot_replace_selected_root_export():
    with make_archive(only_checkpoint=True) as archive, pytest.raises(ValueError):
        prepare.zip_members(archive)


def test_archive_symlink_is_rejected_even_for_ignored_training_file():
    link = zipfile.ZipInfo(prepare.ZIP_ROOT + "training_args.bin")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with make_archive(link) as archive, pytest.raises(ValueError):
        prepare.zip_members(archive)


def test_known_training_pickle_is_not_selected():
    with make_archive(prepare.ZIP_ROOT + "training_args.bin") as archive:
        selected = prepare.zip_members(archive)
        assert set(selected) == prepare.PHOBERT_ASSETS
        assert all("checkpoint-" not in member.filename for member in selected.values())


def test_vihealthbert_directory_packages_only_runtime_assets(tmp_path):
    expected = frozenset({
        "model.safetensors", "config.json", "tokenizer_config.json", "vocab.txt",
        "bpe.codes", "added_tokens.json", "special_tokens_map.json",
    })
    assert prepare.VIHEALTHBERT_ASSETS == expected
    source = tmp_path / prepare.VIHEALTHBERT_ID
    source.mkdir()
    for name in expected:
        (source / name).write_bytes(b"runtime")
    (source / "training_args.bin").write_bytes(b"ignored")
    destination = tmp_path / "release" / prepare.VIHEALTHBERT_ID
    destination.parent.mkdir()
    prepare.prepare_vihealthbert(SimpleNamespace(vihealthbert_dir=source), destination)
    packaged = {path.name for path in destination.iterdir()}
    assert packaged == expected
    assert len(packaged) == 7
    assert "training_args.bin" not in packaged


def test_vihealthbert_directory_rejects_unknown_assets(tmp_path):
    source = tmp_path / prepare.VIHEALTHBERT_ID
    source.mkdir()
    for name in prepare.VIHEALTHBERT_ASSETS:
        (source / name).write_bytes(b"runtime")
    (source / "unexpected.bin").write_bytes(b"unexpected")
    with pytest.raises(ValueError):
        prepare.prepare_vihealthbert(
            SimpleNamespace(vihealthbert_dir=source),
            tmp_path / "release",
        )


@pytest.mark.parametrize("failure", ["manifest", "release"])
def test_release_publication_failure_leaves_no_output_or_partial_manifest(tmp_path, monkeypatch, failure):
    manifest = tmp_path / "model-manifest.json"
    manifest.write_bytes(b'{"original":true}\n')
    staging = tmp_path / ".prepare-test"
    staging.mkdir()
    output = tmp_path / "release"
    def fail(*_args):
        raise OSError(f"{failure} publication failed")

    monkeypatch.setattr(prepare.os, "replace" if failure == "manifest" else "rename", fail)

    with pytest.raises(OSError):
        prepare.publish_release(staging, output, manifest, b'{"replacement":true}\n')

    assert manifest.read_bytes() == b'{"original":true}\n'
    assert not output.exists()
    assert {path.name for path in tmp_path.iterdir()} == {"model-manifest.json", ".prepare-test"}


def test_runtime_assets_cannot_follow_symlinks_outside_release(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    release = tmp_path / "release"
    release.mkdir()
    (release / "model").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        asset_path(release, "model/config.json")


def test_classifier_maps_must_agree():
    names = ["0"] + [f"{prefix}-{label}" for prefix in ("B", "I") for label in sorted(ENTITY_LABELS)]
    config = {"id2label": {str(index): name for index, name in enumerate(names)},
              "label2id": {name: index for index, name in enumerate(names)}}
    config["label2id"]["B-ORGAN"] = 0
    with pytest.raises(ValueError):
        validate_labels(config)


def write_classical_spec(root, model_id):
    model_dir = root / model_id
    model_dir.mkdir()
    names = ["O"] + [f"{prefix}-{label}" for prefix in ("B", "I") for label in sorted(ENTITY_LABELS)]
    labels = {str(index): name for index, name in enumerate(names)}
    artifact_type = "crfsuite-v1" if model_id == "crf" else "linear-npz-v1"
    weight_name = "model.crfsuite" if model_id == "crf" else "model.npz"
    config = {
        "model_id": model_id,
        "artifact_type": artifact_type,
        "id2label": labels,
        "label2id": {name: index for index, name in enumerate(names)},
        "dataset": {
            "repo_id": "leduckhai/VietMed-NER",
            "revision": "e3d0393c733858402a7c04228f45d351d2ce6d8f",
        },
        "metrics": {"validation_f1": 0.8, "test_f1": 0.5},
    }
    (model_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")
    if model_id != "crf":
        (model_dir / "features.json").write_text(
            '{"schema_version":1,"vocabulary":{}}', encoding="utf-8",
        )
    weight = model_dir / weight_name
    weight.write_bytes(b"safe native artifact")
    files = {
        f"{model_id}/{path.name}": sha256_file(path)
        for path in sorted(model_dir.iterdir())
    }
    spec = {
        "repo_id": config["dataset"]["repo_id"],
        "revision": config["dataset"]["revision"],
        "model_path": model_id,
        "weight_path": f"{model_id}/{weight_name}",
        "checkpoint_sha256": files[f"{model_id}/{weight_name}"],
        "token_limit": 4096,
        "id2label": labels,
        "label_map_sha256": canonical_hash(labels),
        "artifact_type": artifact_type,
        "evaluation": config["metrics"],
        "required_assets": list(files),
        "files": files,
    }
    return spec, weight


def test_classical_artifact_hash_is_verified_before_loading(tmp_path):
    spec, weight = write_classical_spec(tmp_path, "logreg")
    uncovered = {
        **spec,
        "required_assets": [path for path in spec["required_assets"] if path != "logreg/features.json"],
        "files": {path: digest for path, digest in spec["files"].items()
                  if path != "logreg/features.json"},
    }
    with pytest.raises(InferenceError) as missing_feature:
        verify_model(tmp_path, "logreg", uncovered)
    assert missing_feature.value.code == "MODEL_INTEGRITY"
    verify_model(tmp_path, "logreg", spec)
    weight.write_bytes(b"corrupted")
    with pytest.raises(InferenceError, match="artifact verification") as failure:
        verify_model(tmp_path, "logreg", spec)
    assert failure.value.code == "MODEL_INTEGRITY"


def test_classical_model_directory_is_fixed_by_model_id(tmp_path):
    spec, _weight = write_classical_spec(tmp_path, "logreg")
    (tmp_path / "logreg").rename(tmp_path / "renamed")
    spec["model_path"] = "renamed"
    spec["weight_path"] = "renamed/model.npz"
    spec["files"] = {path.replace("logreg/", "renamed/", 1): digest
                     for path, digest in spec["files"].items()}
    spec["required_assets"] = list(spec["files"])
    with pytest.raises(InferenceError) as failure:
        verify_model(tmp_path, "logreg", spec)
    assert failure.value.code == "MODEL_INTEGRITY"


@pytest.mark.parametrize(("model_id", "replacement"), [
    ("logreg", "weights.npz"),
    ("crf", "model.npz"),
])
def test_classical_weight_filename_is_fixed_by_model_id(tmp_path, model_id, replacement):
    spec, weight = write_classical_spec(tmp_path, model_id)
    replacement_path = weight.with_name(replacement)
    weight.rename(replacement_path)
    old_relative = spec["weight_path"]
    new_relative = f"{model_id}/{replacement}"
    spec["weight_path"] = new_relative
    spec["files"][new_relative] = spec["files"].pop(old_relative)
    spec["required_assets"] = list(spec["files"])
    with pytest.raises(InferenceError) as failure:
        verify_model(tmp_path, model_id, spec)
    assert failure.value.code == "MODEL_INTEGRITY"
