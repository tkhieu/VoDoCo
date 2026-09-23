"""Phase-14 inference, isolated from training and correction orchestration."""

import hashlib
import math
import time
from pathlib import Path

from .artifacts import (
    BACKGROUND_LABELS, ENTITY_LABELS, MODEL_IDS, asset_path, read_manifest, verify_model,
)
from .audio import DecodedAudio
from .errors import InferenceError


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def adapt_entities(items, text: str, model_id: str, revision: int, supports_offsets: bool) -> list:
    """Keep occurrence order; never search text to invent missing/ambiguous offsets."""
    entities = []
    for item in items:
        label = str(item.get("entity_group", item.get("entity", "")))
        if label in BACKGROUND_LABELS:
            continue
        if label.startswith(("B-", "I-")):
            label = label[2:]
        if label not in ENTITY_LABELS:
            raise InferenceError("NER_LABEL_INVALID", "The model returned an unsupported entity label.",
                                 "recognizing", model_id)
        word = str(item["word"])
        start, end = item.get("start"), item.get("end")
        if not (supports_offsets and isinstance(start, int) and isinstance(end, int)
                and not isinstance(start, bool) and not isinstance(end, bool)
                and 0 <= start < end <= len(text) and text[start:end] == word):
            start = end = None
        score = float(item["score"])
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise InferenceError("NER_OUTPUT_INVALID", "The model returned an invalid entity score.",
                                 "recognizing", model_id)
        entities.append({"id": f"{model_id}:{revision}:{len(entities)}", "text": word,
                         "label": label, "start": start, "end": end,
                         "offset_unit": "unicode_codepoint", "score": score})
    return entities


class ModelRuntime:
    def __init__(self, model_root: Path, manifest_path: Path):
        self.model_root = Path(model_root)
        self.manifest_path = Path(manifest_path)
        self.model_statuses = {
            model_id: {"status": "loading", "identity": None,
                       "token_limit": None if model_id == "asr" else 256,
                       "supports_offsets": False, "error": None}
            for model_id in MODEL_IDS
        }
        self.manifest = None
        self.pipelines = {}
        self.tokenizers = {}
        self.load_measurements = {}
        self._torch = None

    def load(self, on_status):
        try:
            self.manifest = read_manifest(self.manifest_path)
        except (FileNotFoundError, OSError, ValueError, KeyError, TypeError) as exc:
            missing = isinstance(exc, FileNotFoundError)
            for model_id in MODEL_IDS:
                error = InferenceError("MODEL_MISSING" if missing else "MODEL_INTEGRITY",
                                       "The model release manifest is unavailable or invalid.",
                                       "loading", model_id)
                self._publish(model_id, "missing" if missing else "error", error, on_status)
            return
        for model_id in MODEL_IDS:
            started = time.monotonic()
            on_status(model_id, dict(self.model_statuses[model_id]))
            try:
                spec = self.manifest["models"][model_id]
                verify_model(self.model_root, model_id, spec)
                self._load_one(model_id, spec)
                self._torch.cuda.synchronize()
                self.load_measurements[model_id] = {
                    "duration_ms": (time.monotonic() - started) * 1000,
                    "allocated_bytes": self._torch.cuda.memory_allocated(),
                    "peak_allocated_bytes": self._torch.cuda.max_memory_allocated(),
                    "peak_reserved_bytes": self._torch.cuda.max_memory_reserved(),
                }
                self._publish(model_id, "ready", None, on_status)
            except InferenceError as exc:
                self._publish(model_id, "missing" if exc.code == "MODEL_MISSING" else "error", exc, on_status)
            except (ImportError, OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
                error = InferenceError("MODEL_LOAD_FAILED", "The model could not be loaded on CUDA.",
                                       "loading", model_id)
                self._publish(model_id, "error", error, on_status)

    def _publish(self, model_id, status, error, on_status):
        self.model_statuses[model_id]["status"] = status
        self.model_statuses[model_id]["error"] = error.as_dict() if error else None
        on_status(model_id, dict(self.model_statuses[model_id]))

    def _load_one(self, model_id, spec):
        import torch
        from transformers import (
            AutoFeatureExtractor, AutoModelForSpeechSeq2Seq,
            AutoModelForTokenClassification, AutoProcessor, AutoTokenizer, pipeline,
        )

        self._torch = torch
        if not torch.cuda.is_available():
            raise InferenceError("CUDA_UNAVAILABLE", "A working CUDA GPU is required; CPU fallback is disabled.",
                                 "loading", model_id)
        model_path = asset_path(self.model_root, spec["model_path"])
        tokenizer_path = asset_path(self.model_root, spec["tokenizer_path"])
        local = {"local_files_only": True, "trust_remote_code": False}
        if model_id == "asr":
            model = AutoModelForSpeechSeq2Seq.from_pretrained(
                model_path, dtype=torch.float16, low_cpu_mem_usage=True,
                use_safetensors=True, **local,
            ).to("cuda").eval()
            processor = AutoProcessor.from_pretrained(tokenizer_path, **local)
            tokenizer = getattr(processor, "tokenizer", processor)
            features = getattr(processor, "feature_extractor", None)
            if features is None:
                features = AutoFeatureExtractor.from_pretrained(tokenizer_path, **local)
            model_pipeline = pipeline("automatic-speech-recognition", model=model,
                                      tokenizer=tokenizer, feature_extractor=features,
                                      dtype=torch.float16, device=0)
        else:
            # XLM-R's legacy .bin is the exact hashed trusted snapshot. Torch 2.8
            # weights_only refuses arbitrary pickle globals; remote code stays off.
            model = AutoModelForTokenClassification.from_pretrained(
                model_path, dtype=torch.float32, use_safetensors=model_id != "xlmr",
                weights_only=True, **local,
            ).to("cuda").eval()
            tokenizer = AutoTokenizer.from_pretrained(
                tokenizer_path, use_fast=model_id == "xlmr", **local,
            )
            tokenizer.model_max_length = spec["token_limit"]
            if model_id in {"phobert", "vihealthbert-ner-seed2024"} and tokenizer.is_fast:
                raise InferenceError("TOKENIZER_MISMATCH", "The selected slow PhoBERT tokenizer is required.",
                                     "loading", model_id)
            if model_id == "xlmr" and not tokenizer.is_fast:
                raise InferenceError("TOKENIZER_MISMATCH", "The pinned XLM-R fast tokenizer is required.",
                                     "loading", model_id)
            model_pipeline = pipeline("ner", model=model, tokenizer=tokenizer,
                                      aggregation_strategy="simple", device=0,
                                      ignore_labels=sorted(BACKGROUND_LABELS))
        self.pipelines[model_id] = model_pipeline
        self.tokenizers[model_id] = tokenizer
        self.model_statuses[model_id].update({
            "identity": {
                "logical_id": model_id, "repo_id": spec["repo_id"], "revision": spec["revision"],
                "checkpoint_sha256": spec["checkpoint_sha256"],
                "tokenizer": f"{type(tokenizer).__name__}: {spec['tokenizer_identity']}",
                "label_map_sha256": spec["label_map_sha256"],
                "device": str(model.device), "dtype": str(model.dtype).removeprefix("torch."),
            },
            "supports_offsets": bool(model_id != "asr" and tokenizer.is_fast),
        })

    def _require(self, model_id, stage):
        if model_id not in self.pipelines or self.model_statuses[model_id]["status"] != "ready":
            raise InferenceError("MODEL_UNAVAILABLE", "The requested model is not ready.", stage, model_id,
                                 retryable=False)

    def transcribe(self, audio: DecodedAudio) -> dict:
        self._require("asr", "transcribing")
        started = time.monotonic()
        try:
            with self._torch.inference_mode():
                output = self.pipelines["asr"](
                    {"raw": audio.samples, "sampling_rate": 16000},
                    generate_kwargs={"language": "Vietnamese", "task": "transcribe"},
                )
            # Exact phase-14 postprocessing, once; no correction or normalization.
            raw_text = output["text"].strip()
            if not raw_text:
                raise InferenceError("ASR_EMPTY", "No speech transcript was produced.", "transcribing")
            self._torch.cuda.synchronize()
            return {
                "raw_text": raw_text, "text_sha256": text_sha256(raw_text),
                "model": self.model_statuses["asr"]["identity"],
                "generation_settings": self.manifest["models"]["asr"]["generation_settings"],
                "postprocessing": "strip_surrounding_whitespace",
                "duration_ms": (time.monotonic() - started) * 1000,
            }
        except InferenceError:
            raise
        except self._torch.cuda.OutOfMemoryError as exc:
            raise InferenceError("GPU_OUT_OF_MEMORY", "GPU memory was insufficient for transcription.",
                                 "transcribing") from exc
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            raise InferenceError("ASR_FAILED", "Speech transcription failed.", "transcribing") from exc

    def recognize(self, text: str, model_id: str, source: str, revision: int) -> dict:
        started = time.monotonic()
        result = {"status": "failed", "source": source, "revision": revision,
                  "text_sha256": text_sha256(text), "model": None,
                  "entities": [], "error": None, "duration_ms": 0.0}
        try:
            self._require(model_id, "recognizing")
            result["model"] = self.model_statuses[model_id]["identity"]
            tokenizer = self.tokenizers[model_id]
            encoded = tokenizer(text, add_special_tokens=True, truncation=False)
            if len(encoded["input_ids"]) > 256:
                raise InferenceError("NER_INPUT_TOO_LONG", "This model accepts at most 256 tokens including special tokens; text was not truncated.",
                                     "recognizing", model_id)
            with self._torch.inference_mode():
                items = self.pipelines[model_id](text)
            result["entities"] = adapt_entities(items, text, model_id, revision, tokenizer.is_fast)
            self._torch.cuda.synchronize()
            result["status"] = "succeeded"
        except InferenceError as exc:
            result["error"] = exc.as_dict()
        except (RuntimeError, ValueError, KeyError, TypeError, OverflowError) as exc:
            oom = self._torch is not None and isinstance(exc, self._torch.cuda.OutOfMemoryError)
            result["error"] = InferenceError(
                "GPU_OUT_OF_MEMORY" if oom else "NER_FAILED",
                "GPU memory was insufficient for entity recognition." if oom else "Entity recognition failed.",
                "recognizing", model_id,
            ).as_dict()
        result["duration_ms"] = (time.monotonic() - started) * 1000
        return result
