"""Single-process ASGI API; all inference runs in the supervised spawn worker."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.requests import ClientDisconnect

from .jobs import ApiFailure, JobSupervisor, UPLOAD_TIMEOUT
from .schemas import HEX256, NER_IDS, TEXT_BODY_BYTES, UPLOAD_BYTES, NerRequest, canonical_uuid, error


def fail(status: int, code: str, message: str, *, close: bool = False) -> ApiFailure:
    return ApiFailure(status, error(code, message), close=close)


def failure_response(exc: ApiFailure) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if exc.status == 429:
        headers["Retry-After"] = "2"
    if exc.close:
        headers["Connection"] = "close"
    return JSONResponse({"error": exc.issue}, status_code=exc.status, headers=headers)


class ServiceAuthentication:
    def __init__(self, app, owner: FastAPI):
        self.app = app
        self.owner = owner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = scope.get("headers", [])
        # Compare fixed-length hashes, including malformed and non-ASCII headers.
        supplied = [value for key, value in headers if key.lower() == b"authorization"]
        expected = self.owner.state.service_digest
        valid = len(supplied) == 1 and hmac.compare_digest(hashlib.sha256(supplied[0]).digest(), expected)
        public = scope["path"] == "/health/live" and scope["method"] == "GET"
        if not public and not valid:
            response = failure_response(fail(401, "UNAUTHORIZED", "Valid service authentication is required.", close=True))
            await response(scope, receive, send)
            return
        response_started = False

        async def no_store(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                message["headers"] = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"]
                message["headers"].append((b"cache-control", b"no-store"))
            await send(message)

        try:
            await self.app(scope, receive, no_store)
        except Exception:
            # No request/exception repr: those can include clinical text or paths.
            if not response_started:
                response = failure_response(ApiFailure(500, error("INTERNAL_ERROR", "The request could not be completed.", retryable=True)))
                await response(scope, receive, no_store)


def _identity(request: Request, job_id: str, *, polling: bool = False) -> tuple[str, str]:
    try:
        job_id = canonical_uuid(job_id)
    except ValueError:
        raise fail(404 if polling else 400, "JOB_UNAVAILABLE" if polling else "INVALID_REQUEST",
                   "This job is unavailable." if polling else "A valid job ID is required.") from None
    values = request.headers.getlist("x-job-token")
    if len(values) != 1 or HEX256.fullmatch(values[0]) is None:
        raise fail(404, "JOB_UNAVAILABLE", "This job is unavailable.", close=True)
    return job_id, values[0]


def _single_header(request: Request, name: str) -> str:
    values = request.headers.getlist(name)
    if len(values) != 1:
        raise fail(400, "INVALID_REQUEST", "Required request headers are missing or repeated.", close=True)
    return values[0]


def _content_type(request: Request, expected: str) -> None:
    value = _single_header(request, "content-type")
    if value.split(";", 1)[0].strip().lower() != expected:
        raise fail(415, "UNSUPPORTED_MEDIA", "The request content type is not supported.", close=True)


def _length(request: Request, maximum: int) -> None:
    values = request.headers.getlist("content-length")
    if not values:
        return
    if len(values) != 1 or not values[0].isascii() or not values[0].isdigit() or len(values[0]) > 12:
        raise fail(400, "INVALID_REQUEST", "Invalid content length.", close=True)
    if int(values[0]) > maximum:
        raise fail(413, "INPUT_TOO_LARGE", "The request body exceeds its byte limit.", close=True)


def _json_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property")
        result[key] = value
    return result


def _invalid_constant(value: str):
    raise ValueError("Non-finite JSON number")


def create_app(*, service_token: str | None = None, supervisor: JobSupervisor | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        token = service_token if service_token is not None else os.environ.get("INFERENCE_SERVICE_TOKEN", "")
        if len(token.encode("utf-8")) < 32 or any(character.isspace() for character in token):
            raise RuntimeError("INFERENCE_SERVICE_TOKEN must contain at least 32 bytes without whitespace")
        application.state.service_digest = hashlib.sha256(("Bearer " + token).encode("utf-8")).digest()
        root = Path(os.environ.get("VODOCO_MODEL_ROOT", "/opt/vodoco/models"))
        manager = supervisor or JobSupervisor(root, Path(os.environ.get("VODOCO_MODEL_MANIFEST", "/opt/vodoco/model-manifest.json")),
                                            Path(os.environ.get("VODOCO_TEMP_DIR", "/tmp/vodoco-inference")))
        application.state.jobs = manager
        try:
            await manager.start()
            yield
        finally:
            await manager.close()

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    # A fail-closed digest before ASGI startup (also avoids reflecting configuration).
    application.state.service_digest = bytes(32)
    application.add_middleware(ServiceAuthentication, owner=application)

    @application.exception_handler(ApiFailure)
    async def api_failure(request: Request, exc: ApiFailure):
        return failure_response(exc)


    @application.get("/health/live")
    async def live():
        return {"status": "ok"}

    @application.get("/v1/models")
    async def models_v1(request: Request):
        legacy = {model_id: request.app.state.jobs.models[model_id]
                  for model_id in ("asr", "phobert", "xlmr")}
        return {"api_version": "1", "models": legacy,
                "limits": {"upload_bytes": UPLOAD_BYTES, "upload_seconds": 30,
                           "record_seconds": 10, "text_body_bytes": TEXT_BODY_BYTES}}

    @application.get("/v2/models")
    async def models_v2(request: Request):
        return {"api_version": "2", "models": request.app.state.jobs.models,
                "limits": {"upload_bytes": UPLOAD_BYTES, "upload_seconds": 30,
                           "record_seconds": 10, "text_body_bytes": TEXT_BODY_BYTES}}

    @application.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str, request: Request):
        job_id, token = _identity(request, job_id, polling=True)
        return await request.app.state.jobs.get(job_id, token)

    @application.put("/v1/audio-jobs/{job_id}")
    async def audio_job(job_id: str, request: Request):
        job_id, token = _identity(request, job_id)
        _content_type(request, "application/octet-stream")
        try:
            session_id = canonical_uuid(_single_header(request, "x-session-id"))
        except ValueError:
            raise fail(400, "INVALID_REQUEST", "A valid session ID is required.", close=True) from None
        digest = _single_header(request, "x-input-sha256")
        if HEX256.fullmatch(digest) is None:
            raise fail(400, "INVALID_REQUEST", "A valid input SHA-256 is required.", close=True)
        selected = request.query_params.getlist("ner_model")
        if len(selected) != 1 or selected[0] not in NER_IDS or set(request.query_params) != {"ner_model"}:
            raise fail(400, "INVALID_REQUEST", "Select one supported NER model.", close=True)
        manager = request.app.state.jobs
        descriptor, created = await manager.reserve(job_id, token, "audio", session_id, digest, selected)
        if not created:
            # Do not consume a redundant upload. Close this HTTP/1 connection.
            return JSONResponse(descriptor, status_code=202, headers={"Connection": "close"})
        complete = False
        try:
            _length(request, UPLOAD_BYTES)
            hasher = hashlib.sha256()
            received = 0
            path = manager.entries[job_id].path
            with path.open("xb") as upload:
                async with asyncio.timeout(UPLOAD_TIMEOUT):
                    async for chunk in request.stream():
                        received += len(chunk)
                        if received > UPLOAD_BYTES:
                            raise fail(413, "INPUT_TOO_LARGE", "Audio exceeds the 10 MiB limit.", close=True)
                        hasher.update(chunk)
                        upload.write(chunk)
            if not received:
                raise fail(422, "EMPTY_AUDIO", "The audio upload is empty.")
            if not hmac.compare_digest(hasher.hexdigest(), digest):
                raise fail(422, "INPUT_HASH_MISMATCH", "The uploaded bytes do not match their SHA-256.")
            descriptor = await manager.uploaded(job_id)
            complete = descriptor["status"] == "queued"
            return JSONResponse(descriptor, status_code=202)
        except TimeoutError:
            raise ApiFailure(400, error("UPLOAD_FAILED", "The upload exceeded its time budget.", "receiving", retryable=True), close=True) from None
        except ClientDisconnect:
            raise ApiFailure(400, error("UPLOAD_FAILED", "The upload connection was interrupted.", "receiving", retryable=True), close=True) from None
        except OSError:
            raise ApiFailure(503, error("UPLOAD_FAILED", "The upload could not be stored.", "receiving", retryable=True), close=True) from None
        finally:
            if not complete:
                await manager.upload_failed(job_id)

    @application.put("/v1/ner-jobs/{job_id}")
    async def ner_job(job_id: str, request: Request):
        job_id, token = _identity(request, job_id)
        _content_type(request, "application/json")
        _length(request, TEXT_BODY_BYTES)
        body = bytearray()
        try:
            async with asyncio.timeout(UPLOAD_TIMEOUT):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > TEXT_BODY_BYTES:
                        raise fail(413, "INPUT_TOO_LARGE", "The JSON body exceeds 32 KiB.", close=True)
                    body.extend(chunk)
        except (TimeoutError, ClientDisconnect):
            raise fail(400, "INVALID_REQUEST", "The request body was not received completely.", close=True) from None
        try:
            value = json.loads(body.decode("utf-8", errors="strict"), object_pairs_hook=_json_object,
                               parse_constant=_invalid_constant)
            payload = NerRequest.model_validate(value)
        except (ValueError, UnicodeError, ValidationError, RecursionError):
            raise fail(422, "INVALID_INPUT", "Provide valid UTF-8 text, its SHA-256, and supported request fields.") from None
        descriptor, _ = await request.app.state.jobs.reserve(job_id, token, "ner", payload.session_id,
                            payload.text_sha256, payload.models, payload.source, payload.revision, payload.text)
        return JSONResponse(descriptor, status_code=202)

    return application


app = create_app()
