"""HTTP/lifecycle regression tests, intentionally independent of model weights/CUDA."""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
import time
from uuid import uuid4

import httpx
import pytest

from vodoco_inference.app import create_app
from vodoco_inference.jobs import ApiFailure, JobSupervisor, RETENTION
from vodoco_inference.schemas import RESULT_BYTES, UPLOAD_BYTES, encoded, error

SERVICE = "service-test-only-" + "s" * 32
CAPABILITY = "a" * 64
SESSION = str(uuid4())
TEXT = "Bệnh nhân đau đầu."
TEXT_HASH = hashlib.sha256(TEXT.encode()).hexdigest()


class RegistryOnly(JobSupervisor):
    """No model execution in HTTP tests; worker event tests inject completed outcomes."""
    async def start(self):
        self.temp_root.mkdir(parents=True, exist_ok=True)
        self.ready = True
        self.models = self._model_states("ready")


@asynccontextmanager
async def client_for(tmp_path):
    manager = RegistryOnly(tmp_path / "models", tmp_path / "manifest.json", tmp_path / "uploads")
    app = create_app(service_token=SERVICE, supervisor=manager)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                     headers={"Authorization": f"Bearer {SERVICE}"}) as client:
            yield client, manager


def ner_body(**changes):
    return {"session_id": SESSION, "source": "raw", "revision": 0, "text": TEXT,
            "text_sha256": TEXT_HASH, "models": ["phobert"], **changes}


def audio_headers(data, **changes):
    return {"Content-Type": "application/octet-stream", "X-Job-Token": CAPABILITY,
            "X-Session-Id": SESSION, "X-Input-Sha256": hashlib.sha256(data).hexdigest(), **changes}


async def submit_text(client, job_id=None, **changes):
    return await client.put(f"/v1/ner-jobs/{job_id or uuid4()}", json=ner_body(**changes),
                            headers={"X-Job-Token": CAPABILITY})


def test_service_and_capability_isolation(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            assert (await client.get("/health/live", headers={"Authorization": "wrong"})).json() == {"status": "ok"}
            assert (await client.get("/v1/models", headers={"Authorization": "wrong"})).status_code == 401
            response = await submit_text(client)
            job_id = response.json()["job_id"]
            missing = await client.get(f"/v1/jobs/{uuid4()}", headers={"X-Job-Token": "b" * 64})
            wrong = await client.get(f"/v1/jobs/{job_id}", headers={"X-Job-Token": "b" * 64})
            assert wrong.status_code == missing.status_code == 404
            assert wrong.json() == missing.json()
            replacement = await client.put(f"/v1/ner-jobs/{job_id}", json=ner_body(), headers={"X-Job-Token": "b" * 64})
            assert replacement.status_code == 404
            owned = await client.get(f"/v1/jobs/{job_id}", headers={"X-Job-Token": CAPABILITY})
            assert owned.status_code == 200
            assert owned.headers["cache-control"] == "no-store"
            assert CAPABILITY not in owned.text and SERVICE not in owned.text
    asyncio.run(scenario())


def test_atomic_duplicate_capacity_and_conflict(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            job_id = str(uuid4())
            responses = await asyncio.gather(*(submit_text(client, job_id) for _ in range(8)))
            assert {response.status_code for response in responses} == {202}
            assert (await submit_text(client, job_id, models=["xlmr"])).status_code == 409
            assert (await submit_text(client)).status_code == 202
            assert (await submit_text(client)).status_code == 202
            busy = await submit_text(client)
            assert busy.status_code == 429 and busy.headers["retry-after"] == "2"
            assert (await submit_text(client, job_id)).status_code == 202
    asyncio.run(scenario())


def test_receiving_poll_and_replay_never_consume_second_body(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            started, release = asyncio.Event(), asyncio.Event()
            job_id = str(uuid4())
            data = b"original upload"
            async def original():
                started.set()
                yield data[:4]
                await release.wait()
                yield data[4:]
            async def redundant():
                raise AssertionError("An idempotent replay must not read its body")
                yield b""
            task = asyncio.create_task(client.put(f"/v1/audio-jobs/{job_id}?ner_model=phobert",
                                                  headers=audio_headers(data), content=original()))
            await started.wait()
            poll = await client.get(f"/v1/jobs/{job_id}", headers={"X-Job-Token": CAPABILITY})
            assert poll.json()["status"] == "receiving" and poll.json()["result"] is None
            replay = await client.put(f"/v1/audio-jobs/{job_id}?ner_model=phobert",
                                      headers=audio_headers(data), content=redundant())
            assert replay.status_code == 202 and replay.json()["status"] == "receiving"
            assert replay.headers["connection"] == "close"
            release.set()
            accepted = await task
            assert accepted.json()["status"] == "queued"
            assert (manager.temp_root / f"{job_id}.upload").read_bytes() == data
    asyncio.run(scenario())


@pytest.mark.parametrize("declared", [None, "1"])
def test_stream_counter_rejects_lying_or_absent_length_and_releases_capacity(tmp_path, declared):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            job_id = str(uuid4())
            headers = audio_headers(b"irrelevant")
            if declared is not None:
                headers["Content-Length"] = declared
            async def oversized():
                for _ in range(11):
                    yield b"x" * (1024 * 1024)
            rejected = await client.put(f"/v1/audio-jobs/{job_id}?ner_model=phobert", headers=headers, content=oversized())
            assert rejected.status_code == 413
            failed = (await client.get(f"/v1/jobs/{job_id}", headers={"X-Job-Token": CAPABILITY})).json()
            assert failed["status"] == "failed" and failed["errors"][0]["code"] == "UPLOAD_FAILED"
            assert not (manager.temp_root / f"{job_id}.upload").exists()
            assert [(await submit_text(client)).status_code for _ in range(3)] == [202, 202, 202]
    asyncio.run(scenario())


def test_exact_upload_boundary_is_accepted_but_hash_mismatch_is_terminal(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            data = b"x" * UPLOAD_BYTES
            job_id = str(uuid4())
            accepted = await client.put(f"/v1/audio-jobs/{job_id}?ner_model=phobert", headers=audio_headers(data), content=data)
            assert accepted.status_code == 202 and accepted.json()["status"] == "queued"
            wrong_id = str(uuid4())
            rejected = await client.put(f"/v1/audio-jobs/{wrong_id}?ner_model=phobert", headers=audio_headers(b"different"), content=b"bytes")
            assert rejected.status_code == 422
            replay = await client.put(f"/v1/audio-jobs/{wrong_id}?ner_model=phobert", headers=audio_headers(b"different"), content=b"different")
            assert replay.status_code == 202 and replay.json()["status"] == "failed"
            assert not (manager.temp_root / f"{wrong_id}.upload").exists()
    asyncio.run(scenario())


def test_json_unicode_hash_schema_and_byte_bounds(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            for changes in ({"text_sha256": "0" * 64}, {"models": ["phobert", "phobert"]},
                            {"revision": True}, {"extra": "forbidden"}, {"text": "\ud800"}):
                response = await client.put(f"/v1/ner-jobs/{uuid4()}", content=json.dumps(ner_body(**changes)),
                                            headers={"Content-Type": "application/json", "X-Job-Token": CAPABILITY})
                assert response.status_code == 422
            async def oversized():
                yield b" " * 32768
                yield b"x"
            response = await client.put(f"/v1/ner-jobs/{uuid4()}", content=oversized(),
                                        headers={"Content-Type": "application/json", "X-Job-Token": CAPABILITY, "Content-Length": "1"})
            assert response.status_code == 413
            assert (await submit_text(client)).status_code == 202
    asyncio.run(scenario())


def test_vihealthbert_is_an_exact_supported_model_id(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            legacy = (await client.get("/v1/models")).json()
            assert legacy["api_version"] == "1"
            assert set(legacy["models"]) == {"asr", "phobert", "xlmr"}
            current = (await client.get("/v2/models")).json()
            assert current["api_version"] == "2"
            assert set(current["models"]) == {"asr", "phobert", "xlmr", "vihealthbert-ner-seed2024"}
            text_job = await submit_text(client, models=["vihealthbert-ner-seed2024"])
            assert text_job.status_code == 202
            data = b"audio"
            audio_job = await client.put(
                f"/v1/audio-jobs/{uuid4()}?ner_model=vihealthbert-ner-seed2024",
                headers=audio_headers(data),
                content=data,
            )
            assert audio_job.status_code == 202
            unknown = await submit_text(client, models=["vihealthbert-ner-seed2024-typo"])
            assert unknown.status_code == 422
            assert error("TEST", "test", model="vihealthbert-ner-seed2024")["model"] == "vihealthbert-ner-seed2024"
    asyncio.run(scenario())


def identity(model="asr"):
    return {"logical_id": model, "repo_id": None, "revision": None, "checkpoint_sha256": "1" * 64,
            "tokenizer": "test", "label_map_sha256": None, "device": "cuda:0", "dtype": "float32"}


def ner_outcome(model="phobert", success=True):
    return {"status": "succeeded" if success else "failed", "source": "raw", "revision": 0,
            "text_sha256": TEXT_HASH, "model": identity(model), "entities": [], "duration_ms": 1,
            "error": None if success else error("NER_INPUT_TOO_LONG", "Text exceeds token limit.", "recognizing", model=model)}


def test_partial_asr_and_completed_ner_survive_worker_loss(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            job_id = str(uuid4())
            await manager.reserve(job_id, CAPABILITY, "audio", SESSION, "0" * 64, ["phobert"])
            path = manager.entries[job_id].path
            path.write_bytes(b"input")
            await manager.uploaded(job_id)
            manager.active = job_id
            manager._event({"type": "stage", "job_id": job_id, "stage": "transcribing"})
            asr = {"raw_text": TEXT, "text_sha256": TEXT_HASH, "model": identity(), "generation_settings": {},
                   "postprocessing": "strip_surrounding_whitespace", "duration_ms": 1}
            manager._event({"type": "asr", "job_id": job_id, "value": asr,
                            "audio": {"duration_seconds": 1, "original_sample_rate": 16000, "sample_rate": 16000,
                                      "original_channels": 1, "channels": 1, "format": "wav"}})
            before = await manager.get(job_id, CAPABILITY)
            assert before["result"]["asr"]["raw_text"] == TEXT
            manager.replacement_start = True  # Failed replacement stops automatic restart.
            await manager._incident("WORKER_LOST", "The worker stopped.")
            after = await manager.get(job_id, CAPABILITY)
            assert after["status"] == "partial"
            assert after["result"]["asr"] == before["result"]["asr"]
            assert after["result"]["ner"]["phobert"]["status"] == "failed"
            assert not path.exists()
    asyncio.run(scenario())


@pytest.mark.parametrize("outcomes, expected", [([True, True], "succeeded"), ([True, False], "partial"), ([False, False], "failed")])
def test_text_terminal_classification_preserves_empty_successful_columns(tmp_path, outcomes, expected):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            response = await submit_text(client, models=["phobert", "xlmr"])
            job_id = response.json()["job_id"]
            manager.active = job_id
            for model, success in zip(("phobert", "xlmr"), outcomes):
                manager._event({"type": "ner", "job_id": job_id, "model": model, "value": ner_outcome(model, success)})
            manager._event({"type": "done", "job_id": job_id})
            result = await manager.get(job_id, CAPABILITY)
            assert result["status"] == expected
            assert result["result"]["ner"]["phobert"]["status"] == ("succeeded" if outcomes[0] else "failed")
    asyncio.run(scenario())


def test_oversized_column_preserves_prior_success_and_caps_response(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            job_id = (await submit_text(client, models=["phobert", "xlmr"])).json()["job_id"]
            manager.active = job_id
            manager._event({"type": "ner", "job_id": job_id, "model": "phobert", "value": ner_outcome()})
            oversized = ner_outcome("xlmr")
            oversized["entities"] = [{"id": "oversized", "text": "x" * RESULT_BYTES, "label": "ORGAN",
                                       "start": None, "end": None, "offset_unit": "unicode_codepoint"}]
            manager._event({"type": "ner", "job_id": job_id, "model": "xlmr", "value": oversized})
            manager._event({"type": "done", "job_id": job_id})
            result = await manager.get(job_id, CAPABILITY)
            assert result["status"] == "partial" and len(encoded(result)) <= RESULT_BYTES
            assert result["result"]["ner"]["phobert"]["status"] == "succeeded"
            assert result["result"]["ner"]["xlmr"]["error"]["code"] == "RESULT_TOO_LARGE"
    asyncio.run(scenario())


def test_retention_evicts_oldest_and_polling_never_refreshes_expiry(tmp_path):
    async def scenario():
        async with client_for(tmp_path) as (client, manager):
            ids = []
            for _ in range(65):
                job_id = (await submit_text(client)).json()["job_id"]
                ids.append(job_id)
                manager._finish(manager.entries[job_id], error("TEST_FAILURE", "Stopped.", "worker"))
            assert (await client.get(f"/v1/jobs/{ids[0]}", headers={"X-Job-Token": CAPABILITY})).status_code == 404
            latest = await manager.get(ids[-1], CAPABILITY)
            assert (await manager.get(ids[-1], CAPABILITY))["expires_at"] == latest["expires_at"]
            manager.entries[ids[-1]].terminal_at = time.monotonic() - RETENTION - 1
            with pytest.raises(ApiFailure) as unavailable:
                await manager.get(ids[-1], CAPABILITY)
            assert unavailable.value.status == 404
    asyncio.run(scenario())
