import importlib.util
import io
import stat
import zipfile
from types import SimpleNamespace
from pathlib import Path

import pytest

from vodoco_inference.artifacts import asset_path, validate_labels

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


def test_runtime_assets_cannot_follow_symlinks_outside_release(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    release = tmp_path / "release"
    release.mkdir()
    (release / "model").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        asset_path(release, "model/config.json")


def test_classifier_maps_must_agree():
    from vodoco_inference.artifacts import ENTITY_LABELS

    names = ["0"] + [f"{prefix}-{label}" for prefix in ("B", "I") for label in sorted(ENTITY_LABELS)]
    config = {"id2label": {str(index): name for index, name in enumerate(names)},
              "label2id": {name: index for index, name in enumerate(names)}}
    config["label2id"]["B-ORGAN"] = 0
    with pytest.raises(ValueError):
        validate_labels(config)
