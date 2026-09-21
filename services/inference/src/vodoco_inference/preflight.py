"""Run a real, offline CUDA ASR → PhoBERT/XLM-R readiness gate on approved audio."""

import argparse
import importlib.metadata
import json
import platform
import sys
import time
from pathlib import Path

from .audio import decode_audio
from .errors import InferenceError
from .runtime import ModelRuntime


def tokenizer_observation(tokenizer, text: str) -> dict:
    encoded = tokenizer(text, add_special_tokens=True, truncation=False)
    observation = {
        "class": type(tokenizer).__name__, "is_fast": bool(tokenizer.is_fast),
        "configured_token_limit": tokenizer.model_max_length,
        "input_tokens_including_special": len(encoded["input_ids"]),
        "offsets": "unavailable-list-only", "probe": None,
    }
    if tokenizer.is_fast:
        probe_text = "đau đầu 👩🏽‍⚕️ đau đầu e\u0301"
        probe = tokenizer(probe_text, add_special_tokens=True, truncation=False,
                          return_offsets_mapping=True, return_special_tokens_mask=True)
        spans = [list(span) for span, special in zip(probe["offset_mapping"], probe["special_tokens_mask"])
                 if not special]
        valid = all(0 <= start < end <= len(probe_text) for start, end in spans)
        observation["offsets"] = "codepoint-boundaries-valid" if valid else "invalid-boundaries-list-only"
        observation["probe"] = {"text": probe_text, "spans": spans, "valid_boundaries": valid}
    return observation


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True,
                        help="Operator-approved non-patient audio; transcript is printed in the report")
    parser.add_argument("--report", type=Path, help="Optional local JSON evidence file")
    args = parser.parse_args(argv)
    report = {"status": "failed", "correction": False, "python": platform.python_version(),
              "versions": {}, "models": {}, "load_measurements": {}, "tokenizers": {},
              "cuda": None, "audio": None, "asr": None, "ner": {}, "error": None}
    started = time.monotonic()
    try:
        for package in ("torch", "transformers", "tokenizers", "safetensors", "numpy", "sentencepiece"):
            report["versions"][package] = importlib.metadata.version(package)
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
            properties = torch.cuda.get_device_properties(0)
            report["cuda"] = {"device": torch.cuda.get_device_name(0),
                              "capability": list(torch.cuda.get_device_capability(0)),
                              "total_memory_bytes": properties.total_memory,
                              "runtime": torch.version.cuda}
        runtime = ModelRuntime(args.model_root, args.manifest)
        runtime.load(lambda model_id, status: report["models"].__setitem__(model_id, status))
        report["load_measurements"] = runtime.load_measurements
        if not all(value["status"] == "ready" for value in report["models"].values()):
            raise InferenceError("PREFLIGHT_MODELS_NOT_READY", "All three verified models must load on CUDA.", "loading")
        audio = decode_audio(args.audio)
        report["audio"] = audio.metadata
        report["asr"] = runtime.transcribe(audio)
        text = report["asr"]["raw_text"]
        for model_id in ("phobert", "xlmr"):
            report["tokenizers"][model_id] = tokenizer_observation(runtime.tokenizers[model_id], text)
            result = runtime.recognize(text, model_id, "raw", 0)
            report["ner"][model_id] = result
            report["tokenizers"][model_id]["entity_offsets"] = {
                "valid": sum(entity["start"] is not None for entity in result["entities"]),
                "unavailable": sum(entity["start"] is None for entity in result["entities"]),
            }
        torch.cuda.synchronize()
        if not all(result["status"] == "succeeded" for result in report["ner"].values()):
            raise InferenceError("PREFLIGHT_INFERENCE_FAILED", "Both NER models must complete the real ASR transcript.", "recognizing")
        report["status"] = "ready"
    except InferenceError as exc:
        report["error"] = exc.as_dict()
    except (ImportError, importlib.metadata.PackageNotFoundError, OSError, RuntimeError, ValueError) as exc:
        report["error"] = InferenceError("PREFLIGHT_FAILED", "Preflight dependencies or runtime are unavailable.", "preflight").as_dict()
    finally:
        torch_module = sys.modules.get("torch")
        if torch_module is not None and torch_module.cuda.is_available():
            report["peak_gpu_allocated_bytes"] = torch_module.cuda.max_memory_allocated()
            report["peak_gpu_reserved_bytes"] = torch_module.cuda.max_memory_reserved()
        report["duration_ms"] = (time.monotonic() - started) * 1000
    content = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content, encoding="utf-8")
    print(content, end="")
    return 0 if report["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
