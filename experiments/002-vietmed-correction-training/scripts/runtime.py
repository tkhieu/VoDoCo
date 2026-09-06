"""Portable configuration, pinned source models and measured runtime provenance."""
from __future__ import annotations

import ctypes
import hashlib
import importlib.metadata
import os
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from common import ROOT, read_json, sha256_file, signature, write_json

MODEL_REVISIONS = {
    "asr": ("leduckhai/MultiMed-ST", "fb15edd1dfc68810a7d0c75e6cfc73c3e5ed01c1"),
    "correction": ("bmd1905/vietnamese-correction-v2", "a3d342348d39d87622aa58aabd07de38ade8c17b"),
    "ner": ("leduckhai/VietMed-NER", "cccffb7de14423114f7d4bafc9f736b9d866e446"),
}
ASR_PREFIX = "asr/whisper-small-vietnamese"
NER_PREFIX = "xlm-roberta-base-VietMed-NER"


def make_config(root=None, mode="full"):
    if mode not in {"full", "smoke"}:
        raise ValueError("mode must be full or smoke")
    root = Path(root or ROOT).expanduser().resolve()
    if not (root / "RESEARCH_PLAN.md").is_file():
        raise FileNotFoundError("PROJECT_ROOT must contain RESEARCH_PLAN.md")
    experiment = root / "experiments/002-vietmed-correction-training"
    source = next(row for row in read_json(root / "datasets/sources.json")["sources"]
                  if row["repo_id"] == "leduckhai/VietMed")
    if source["revision"] != "cc7980cd1392d2d85cf1c692b1d96e8581fc7eec":
        raise ValueError("VietMed revision differs from the locked research protocol")
    cfg = {
        "root": str(root), "experiment_dir": str(experiment),
        "derived_dir": str(root / "datasets/derived/correction"),
        "outputs_dir": str(experiment / "outputs" / mode),
        "models_dir": str(experiment / "models"),
        "mode": mode, "seed": 42, "seeds": [42, 43, 44],
        "device": "cuda", "precision": "bf16", "source": source,
        "asr_batch_size": 8, "eval_batch_size": 16, "ner_batch_size": 32,
        "max_source_tokens": 512, "max_target_tokens": 512,
        "generation": {"num_beams": 4, "do_sample": False, "max_new_tokens": 512},
        "training": {"rank": 16, "alpha": 32, "dropout": 0.05,
                     "learning_rate": 1e-4, "weight_decay": 0.01,
                     "max_grad_norm": 1.0, "warmup_ratio": 0.05,
                     "batch_size": 2, "gradient_accumulation_steps": 8,
                     "epochs": 5, "patience": 2, "errorful_fraction": 0.7},
        "bootstrap": {"replicates": 2000, "seed": 42},
        "selection_policy": {
            "checkpoint": "minimum generated dev corpus WER, then preservation, then earliest epoch",
            "export_seed": "minimum best-checkpoint dev WER, then preservation, then seed",
            "review_status": "pending_human_review",
            "deployment": "not_approved_without_content_review; retain R0 if quantitative criteria fail",
            "minimum_relative_wer_reduction": 0.02,
        },
        "auxiliary": {
            "enabled": False, "runs_omitted": ["R4", "R3-budget"],
            "reason": "No approved rights/text-review/source-group/noise manifest; R3 is independent.",
            "required_before_enable": ["rights", "reviewed clean targets", "parent/source groups",
                                       "train-only noise profile", "matched-budget R3-budget"],
        },
        "reference_limitations": "Upstream transcript boundaries may omit speech; test was observed historically.",
    }
    for key in ("derived_dir", "outputs_dir", "models_dir"):
        Path(cfg[key]).mkdir(parents=True, exist_ok=True)
    return cfg


def _nvml():
    try:
        lib = ctypes.CDLL("libnvidia-ml.so.1")
        if lib.nvmlInit_v2():
            return {"status": "initialization_failed"}
        try:
            driver = ctypes.create_string_buffer(96)
            code = lib.nvmlSystemGetDriverVersion(driver, 96)
            return {"driver": driver.value.decode() if code == 0 else None}
        finally:
            lib.nvmlShutdown()
    except OSError as error:
        return {"status": str(error)}


def inspect_runtime(cfg):
    import torch
    from common import seed_everything
    names = ["torch", "transformers", "peft", "accelerate", "datasets", "pyarrow",
             "soundfile", "jiwer", "sentencepiece", "numpy", "scipy", "librosa",
             "huggingface-hub", "nbclient", "nbformat", "ipykernel"]
    versions = {name: importlib.metadata.version(name) for name in names}
    if not torch.cuda.is_available():
        raise RuntimeError("Full local training requires a working CUDA runtime")
    cfg["precision"] = "bf16" if torch.cuda.is_bf16_supported() else "fp16"
    seed_everything(cfg["seed"])
    device = torch.cuda.get_device_properties(0)
    # Exercise CUDA GEMM, autocast and autograd; enumeration alone proves nothing.
    a = torch.randn(64, 64, device="cuda", requires_grad=True)
    with torch.autocast("cuda", dtype=torch.bfloat16 if cfg["precision"] == "bf16" else torch.float16):
        loss = (a @ a.T).square().mean()
    loss.backward()
    torch.cuda.synchronize()
    if not torch.isfinite(loss) or not torch.isfinite(a.grad).all():
        raise RuntimeError("CUDA forward/backward produced non-finite values")
    measured = float(loss.detach())
    del a, loss
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=cfg["root"],
                            capture_output=True, text=True, check=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain=v1"], cwd=cfg["root"],
                           capture_output=True, text=True, check=True).stdout.splitlines()
    scripts = Path(cfg["experiment_dir"]) / "scripts"
    code_hashes = {str(p.relative_to(cfg["root"])): sha256_file(p)
                   for p in sorted(scripts.glob("*.py"))}
    info = {
        "python": platform.python_version(), "executable": sys.executable,
        "libraries": versions, "cuda": torch.version.cuda,
        "gpu": device.name, "gpu_total_bytes": device.total_memory,
        "compute_capability": [device.major, device.minor],
        "compiled_cuda_architectures": torch.cuda.get_arch_list(),
        "precision": cfg["precision"], "nvml": _nvml(),
        "cuda_forward_backward_loss": measured,
        "git_commit": commit, "git_changes": dirty, "code_sha256": code_hashes,
        "plan_sha256": sha256_file(Path(cfg["root"]) / "RESEARCH_PLAN.md"),
    }
    cfg["environment"] = info
    write_json(Path(cfg["outputs_dir"]) / "environment.json", info)
    write_json(Path(cfg["outputs_dir"]) / "auxiliary-gates.json", cfg["auxiliary"])
    return info


def _model_files(kind, siblings):
    names = []
    for item in siblings:
        name = item.rfilename
        if kind == "asr":
            parent = str(Path(name).parent)
            keep = parent in {ASR_PREFIX, ASR_PREFIX + "/checkpoint-5000"}
            keep = keep and (name.endswith((".json", "merges.txt", "vocab.json", "model.safetensors")))
            keep = keep and not name.endswith("trainer_state.json")
        elif kind == "ner":
            keep = str(Path(name).parent) == NER_PREFIX and name.endswith((".json", ".model", "pytorch_model.bin"))
        else:
            keep = "/" not in name and name.endswith((".json", ".model", "dict.txt", "model.safetensors"))
        if keep:
            names.append(item)
    if not any(row.rfilename.endswith((".safetensors", "pytorch_model.bin")) for row in names):
        raise RuntimeError(f"No source weights selected for {kind}")
    return names


def _verify_hub_file(path, metadata):
    if not path.is_file() or path.stat().st_size != metadata.size:
        return False
    if metadata.lfs:
        expected = metadata.lfs.sha256
        return sha256_file(path) == expected
    h = hashlib.sha1()
    h.update(f"blob {metadata.size}\0".encode())
    h.update(path.read_bytes())
    return h.hexdigest() == metadata.blob_id


def prepare_models(cfg):
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi()
    result = {}
    for kind, (repo, revision) in MODEL_REVISIONS.items():
        destination = Path(cfg["models_dir"]) / "sources" / kind / revision
        info = api.model_info(repo, revision=revision, files_metadata=True)
        if info.sha != revision:
            raise RuntimeError(f"Unresolved model revision: {repo}")
        entries = _model_files(kind, info.siblings)
        hashes = {}
        for item in entries:
            target = destination / item.rfilename
            if not _verify_hub_file(target, item):
                previous = (Path(cfg["root"]) / "experiments/001-zeroshot-correction-vietmed"
                            / "models/vietnamese-correction-v2" / item.rfilename)
                if kind == "correction" and _verify_hub_file(previous, item):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(previous, target)
                else:
                    hf_hub_download(repo, item.rfilename, revision=revision,
                                    local_dir=destination)
                if not _verify_hub_file(target, item):
                    raise RuntimeError(f"Model file hash mismatch: {target}")
            hashes[item.rfilename] = sha256_file(target)
        record = {"repo_id": repo, "revision": revision, "path": str(destination), "hashes": hashes}
        if kind == "asr":
            record["model_path"] = str(destination / ASR_PREFIX / "checkpoint-5000")
            record["processor_path"] = str(destination / ASR_PREFIX)
        elif kind == "ner":
            record["path"] = str(destination / NER_PREFIX)
            record["hashes"] = {str(Path(k).relative_to(NER_PREFIX)): v for k, v in hashes.items()}
        result[kind] = record
        print(f"Verified {kind}: {repo}@{revision} ({len(hashes)} files)", flush=True)
    cfg["models"] = result
    write_json(Path(cfg["derived_dir"]) / "manifests/model-snapshots.json", result)
    write_json(Path(cfg["outputs_dir"]) / "resolved-config.json", cfg)
    return result


def portable_model_signature(cfg):
    return {kind: {key: value for key, value in info.items() if key in {"repo_id", "revision", "hashes"}}
            for kind, info in cfg["models"].items()}


def lock_recipe(cfg, pairs, dev_records):
    payload = {
        "source_revision": cfg["source"]["revision"],
        "pairs_sha256": signature(pairs),
        "dev_identity_sha256": signature([{k: r[k] for k in ("id", "reference_text", "asr_signature")}
                                          for r in dev_records]),
        "models": portable_model_signature(cfg),
        "training": cfg["training"], "generation": cfg["generation"],
        "max_source_tokens": cfg["max_source_tokens"], "max_target_tokens": cfg["max_target_tokens"],
        "precision": cfg["precision"], "seeds": cfg["seeds"], "mode": cfg["mode"],
        "sampler": "fixed seeded 70/30 errorful/identity draws, number of draws = pair count per epoch",
        "selection_policy": cfg["selection_policy"],
        "libraries": cfg["environment"]["libraries"],
        "matrix": ["R0", "R1", "R2", "R3_seed42", "R3_seed43", "R3_seed44"],
        "bootstrap": cfg["bootstrap"],
        "normalization_sha256": sha256_file(Path(cfg["root"]) / "experiments/001-zeroshot-correction-vietmed/scripts/text-normalization-utils.py"),
        "evaluation_code_sha256": sha256_file(Path(__file__).with_name("evaluation.py")),
    }
    cfg["recipe_signature"] = signature(payload)
    path = Path(cfg["outputs_dir"]) / "recipe-lock.json"
    if path.exists() and read_json(path)["signature"] != cfg["recipe_signature"]:
        raise RuntimeError("Existing recipe lock differs; create a declared new experiment namespace")
    if not path.exists():
        write_json(path, {"signature": cfg["recipe_signature"], "locked_at": datetime.now(timezone.utc).isoformat(),
                          "protocol": payload})
    return read_json(path)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Prepare the pinned correction runtime and source models")
    parser.add_argument("--mode", choices=["full", "smoke"], default="full")
    arguments = parser.parse_args()
    configuration = make_config(mode=arguments.mode)
    environment = inspect_runtime(configuration)
    print(f"CUDA forward/backward verified: {environment['gpu']} / {environment['precision']}", flush=True)
    prepare_models(configuration)
    print("Pinned source models ready", flush=True)
