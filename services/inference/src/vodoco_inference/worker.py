"""Spawn-only CUDA owner. IPC contains no capabilities or service credentials."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from .schemas import RESULT_BYTES, encoded, error


def worker_process(target, args: tuple) -> None:
    # Spawn starts in the ASGI process group. Isolate before model imports or
    # decoders so the supervisor can stop every resource owned by this worker.
    os.setsid()
    target(*args)


def worker_main(commands, events, model_root: str, manifest_path: str) -> None:

    def send(event: dict) -> None:
        events.send(event)

    try:
        # Import torch/transformers only here: the ASGI parent never initializes CUDA.
        from .audio import decode_audio
        from .errors import InferenceError
        from .runtime import ModelRuntime

        runtime = ModelRuntime(Path(model_root), Path(manifest_path))
        runtime.load(lambda model, status: send({"type": "model", "model": model, "value": status}))
        send({"type": "ready"})
    except Exception:
        send({"type": "startup_error"})
        return

    while True:
        task = commands.get()
        if task is None:
            return
        job_id = task["job_id"]
        stage = "decoding" if task["kind"] == "audio" else "recognizing"

        def emit(kind: str, **values) -> None:
            send({"type": kind, "job_id": job_id, **values})

        def bounded(value: dict) -> dict:
            if len(encoded(value)) > RESULT_BYTES - 8192:
                raise InferenceError("RESULT_TOO_LARGE", "The model result exceeds the response limit.", stage)
            return value

        path = Path(task["path"]) if task.get("path") else None
        try:
            emit("stage", stage=stage)
            if path is not None:
                audio = decode_audio(path)
                stage = "transcribing"
                emit("stage", stage=stage)
                asr = bounded(runtime.transcribe(audio))
                if not asr["raw_text"].strip():
                    raise InferenceError("ASR_EMPTY", "No usable speech was recognized.", stage)
                text = asr["raw_text"]
                emit("asr", audio=audio.metadata, value=asr)
            else:
                text = task["text"]
            stage = "recognizing"
            emit("stage", stage=stage)
            for model in task["models"]:
                try:
                    outcome = bounded(runtime.recognize(text, model, task["source"], task["revision"]))
                except Exception as exc:
                    issue = (exc.as_dict() if isinstance(exc, InferenceError) else
                             error("NER_FAILED", "The selected model could not process this text.", stage, model=model))
                    issue["model"] = model
                    outcome = {"status": "failed", "source": task["source"], "revision": task["revision"],
                               "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                               "model": runtime.model_statuses[model]["identity"], "entities": [],
                               "error": issue, "duration_ms": 0}
                emit("ner", model=model, value=outcome)
            emit("done")
        except Exception as exc:
            issue = (exc.as_dict() if isinstance(exc, InferenceError) else
                     error("INFERENCE_FAILED", "The inference task could not be completed.", stage, retryable=True))
            emit("failed", error=issue)
        finally:
            if path is not None:
                path.unlink(missing_ok=True)
            # Do not retain a previous patient's text while idle.
            task = None
            text = None
            audio = None
            asr = None
            outcome = None
