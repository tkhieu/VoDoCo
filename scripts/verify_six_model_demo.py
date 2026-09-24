#!/usr/bin/env python3
"""Verify authenticated readiness and one fixed text through all six NER models."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

NER_IDS = ("logreg", "linear-svm", "crf", "xlmr", "phobert", "vihealthbert-ner-seed2024")
CLASSICAL_IDS = frozenset(("logreg", "linear-svm", "crf"))
TEXT = "Bệnh nhân bị rong huyết, đã dùng thuốc."
TERMINAL = frozenset(("succeeded", "partial", "failed"))


def request_json(base_url: str, token: str, path: str, *, method: str = "GET",
                 body: dict | None = None, job_token: str | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(
        body, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if job_token is not None:
        headers["X-Job-Token"] = job_token
    request = Request(f"{base_url.rstrip('/')}{path}", data=data, headers=headers, method=method)
    with urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def wait_for_registry(base_url: str, token: str, deadline: float) -> dict:
    expected_ids = ["asr", *NER_IDS]
    while time.monotonic() < deadline:
        try:
            status, registry = request_json(base_url, token, "/v2/models")
        except (HTTPError, URLError, OSError):
            time.sleep(1)
            continue
        if status != 200 or list(registry.get("models", {})) != expected_ids:
            raise ValueError("/v2/models did not return the exact ordered registry")
        states = registry["models"]
        failed = [model_id for model_id, state in states.items() if state.get("status") == "error"]
        if failed:
            raise ValueError(f"Runtime model failed to load: {', '.join(failed)}")
        if all(state.get("status") == "ready" for state in states.values()):
            return registry
        time.sleep(1)
    raise TimeoutError("Model registry did not become ready before the deadline")


def poll_job(base_url: str, token: str, job_id: str, job_token: str, deadline: float) -> dict:
    while time.monotonic() < deadline:
        status, job = request_json(
            base_url, token, f"/v1/jobs/{job_id}", job_token=job_token,
        )
        if status != 200:
            raise ValueError("Job poll did not return HTTP 200")
        if job.get("status") in TERMINAL:
            return job
        time.sleep(0.5)
    raise TimeoutError("NER smoke job exceeded its deadline")


def validate_entities(text: str, model_id: str, result: dict) -> dict:
    if result.get("status") != "succeeded" or result.get("model", {}).get("logical_id") != model_id:
        raise ValueError(f"{model_id} did not return a successful matching identity")
    valid_offsets = 0
    unavailable_offsets = 0
    for entity in result.get("entities", []):
        start, end = entity.get("start"), entity.get("end")
        if start is None or end is None:
            if start is not None or end is not None:
                raise ValueError(f"{model_id} returned a half-null entity offset")
            unavailable_offsets += 1
        elif (isinstance(start, bool) or isinstance(end, bool)
              or not isinstance(start, int) or not isinstance(end, int)
              or not 0 <= start < end <= len(text)
              or text[start:end] != entity.get("text")):
            raise ValueError(f"{model_id} returned an invalid source offset")
        else:
            valid_offsets += 1
        if model_id in CLASSICAL_IDS and entity.get("score") is not None:
            raise ValueError(f"{model_id} must return score null")
    return {
        "entities": len(result.get("entities", [])),
        "valid_offsets": valid_offsets,
        "unavailable_offsets": unavailable_offsets,
        "device": result["model"]["device"],
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=600.0)
    args = parser.parse_args(argv)
    token = os.environ.get("INFERENCE_SERVICE_TOKEN", "")
    if len(token.encode("utf-8")) < 32 or any(character.isspace() for character in token):
        raise SystemExit("INFERENCE_SERVICE_TOKEN must be set to the service credential")

    try:
        deadline = time.monotonic() + args.timeout
        registry = wait_for_registry(args.base_url, token, deadline)
        for model_id, state in registry["models"].items():
            expected_device = "cpu" if model_id in CLASSICAL_IDS else "cuda:0"
            if state.get("identity", {}).get("device") != expected_device:
                raise ValueError(f"{model_id} is on the wrong device")

        digest = hashlib.sha256(TEXT.encode("utf-8")).hexdigest()
        results = {}
        for index in range(0, len(NER_IDS), 2):
            models = list(NER_IDS[index:index + 2])
            job_id = str(uuid4())
            job_token = os.urandom(32).hex()
            body = {
                "session_id": str(uuid4()),
                "source": "raw",
                "revision": 0,
                "text": TEXT,
                "text_sha256": digest,
                "models": models,
            }
            accepted, descriptor = request_json(
                args.base_url, token, f"/v1/ner-jobs/{job_id}", method="PUT",
                body=body, job_token=job_token,
            )
            if accepted != 202 or descriptor.get("job_id") != job_id:
                raise ValueError("NER submission was not accepted with the requested job identity")
            job = poll_job(args.base_url, token, job_id, job_token, deadline)
            if job.get("status") not in {"succeeded", "partial"}:
                raise ValueError("NER smoke job failed")
            payload = job.get("result") or {}
            if (payload.get("source") != "raw" or payload.get("revision") != 0
                    or payload.get("text_sha256") != digest):
                raise ValueError("NER smoke result changed the source identity")
            for model_id in models:
                results[model_id] = validate_entities(TEXT, model_id, payload.get("ner", {}).get(model_id, {}))

        if list(results) != list(NER_IDS):
            raise ValueError("NER smoke did not return all six models in ladder order")
        print(json.dumps({
            "status": "verified",
            "registry": list(registry["models"]),
            "text_sha256": digest,
            "models": results,
        }, ensure_ascii=False, indent=2))
        return 0
    except (HTTPError, URLError, OSError, TimeoutError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "failed", "error": type(exc).__name__, "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
