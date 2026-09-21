"""HTTP input validation and fixed transport limits (OpenAPI is authoritative)."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

UPLOAD_BYTES = 10_485_760
TEXT_BODY_BYTES = 32_768
RESULT_BYTES = 262_144
MODEL_IDS = ("asr", "phobert", "xlmr")
NER_IDS = ("phobert", "xlmr")
TERMINAL = frozenset(("succeeded", "partial", "failed"))
HEX256 = re.compile(r"[a-f0-9]{64}\Z")
NerModel = Literal["phobert", "xlmr"]


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def error(code: str, message: str, stage: str = "request", *, model: str | None = None,
          retryable: bool = False) -> dict:
    result = {"code": code, "stage": stage, "retryable": retryable, "message": message}
    if model in NER_IDS:
        result["model"] = model
    return result


def canonical_uuid(value: str) -> str:
    if len(value) != 36:
        raise ValueError("Invalid UUID")
    parsed = str(UUID(value))
    if value.lower() != parsed:
        raise ValueError("Invalid UUID")
    return parsed


class NerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    session_id: str
    source: Literal["raw", "review"]
    revision: Annotated[int, Field(ge=0)]
    text: Annotated[str, Field(min_length=1)]
    text_sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    models: Annotated[list[NerModel], Field(min_length=1, max_length=2)]

    @field_validator("session_id")
    @classmethod
    def validate_session(cls, value: str) -> str:
        return canonical_uuid(value)

    @model_validator(mode="after")
    def validate_content(self) -> NerRequest:
        try:
            data = self.text.encode("utf-8", errors="strict")
        except UnicodeError as exc:
            raise ValueError("Invalid Unicode") from exc
        if not self.text.strip():
            raise ValueError("Text must not be empty")
        if hashlib.sha256(data).hexdigest() != self.text_sha256:
            raise ValueError("Text hash mismatch")
        if len(set(self.models)) != len(self.models):
            raise ValueError("Duplicate models")
        return self
