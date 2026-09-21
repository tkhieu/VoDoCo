"""Deadlines, interrupted uploads, and replacement limits without GPU/model imports."""
import asyncio
import ctypes
import gc
import hashlib
import os
from pathlib import Path
import shutil
import signal
import sys
import time
import weakref
from uuid import uuid4

import httpx
import pytest
from starlette.requests import ClientDisconnect

from vodoco_inference.app import create_app
from vodoco_inference import jobs
from vodoco_inference.jobs import JobSupervisor


class QuietSupervisor(JobSupervisor):
    async def start(self):
        self.temp_root.mkdir(parents=True, exist_ok=True)
        self.ready = True
        self.models = self._model_states("ready")


def test_interrupted_upload_is_retained_as_failed_and_removes_input(tmp_path):
    async def scenario():
        manager = QuietSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        app = create_app(service_token="s" * 32, supervisor=manager)
        job_id = str(uuid4())
        async def disconnected():
            yield b"incomplete"
            raise ClientDisconnect()
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                headers = {"Authorization": "Bearer " + "s" * 32, "X-Job-Token": "a" * 64,
                           "X-Input-Sha256": hashlib.sha256(b"incomplete body").hexdigest(),
                           "X-Session-Id": str(uuid4()), "Content-Type": "application/octet-stream"}
                response = await client.put(f"/v1/audio-jobs/{job_id}?ner_model=phobert", headers=headers, content=disconnected())
                assert response.status_code == 400
                poll = await client.get(f"/v1/jobs/{job_id}", headers=headers)
                assert poll.json()["status"] == "failed"
                assert poll.json()["errors"][0]["code"] == "UPLOAD_FAILED"
                assert not (manager.temp_root / f"{job_id}.upload").exists()
    asyncio.run(scenario())


def test_queue_and_receiving_deadlines_release_input_and_admission(tmp_path):
    async def scenario():
        manager = QuietSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        audio_id, text_id = str(uuid4()), str(uuid4())
        await manager.reserve(audio_id, "a" * 64, "audio", str(uuid4()), "0" * 64, ["phobert"])
        await manager.reserve(text_id, "a" * 64, "ner", str(uuid4()), "1" * 64, ["phobert"], text="text")
        manager.entries[audio_id].path.write_bytes(b"incomplete")
        manager.entries[audio_id].admitted_at = time.monotonic() - 61
        manager.entries[text_id].queued_at = time.monotonic() - 121
        manager.monitor = asyncio.create_task(manager._watch())
        try:
            async with asyncio.timeout(2):
                while (await manager.get(audio_id, "a" * 64))["status"] != "failed":
                    await asyncio.sleep(0.01)
            assert (await manager.get(text_id, "a" * 64))["errors"][0]["code"] == "QUEUE_TIMEOUT"
            assert not (manager.temp_root / f"{audio_id}.upload").exists()
        finally:
            await manager.close()
    asyncio.run(scenario())


async def eventually(predicate, timeout=10):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


def sleeping_worker(commands, events, model_root, manifest_path):
    time.sleep(60)


def ready_worker(commands, events, model_root, manifest_path):
    events.send({"type": "ready"})
    time.sleep(60)


def decoder_worker(commands, events, model_root, manifest_path):
    from vodoco_inference.audio import _bounded_process
    descriptor = os.open(os.devnull, os.O_RDONLY)
    # Record the child's identity before exec, then run a real long-lived
    # ffmpeg decoder through the same bounded subprocess owner as uploads.
    wrapper = ("import os,pathlib,sys; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); "
               "os.execvp(sys.argv[2], sys.argv[2:])")
    try:
        _bounded_process(
            [sys.executable, "-c", wrapper, manifest_path, "ffmpeg", "-nostdin", "-v", "error",
             "-re", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "60", "-f", "null", "-"],
            32, time.monotonic() + 15, descriptor,
        )
    finally:
        os.close(descriptor)


def subreaper_state():
    state = ctypes.c_int()
    assert ctypes.CDLL(None).prctl(37, ctypes.byref(state), 0, 0, 0) == 0
    return state.value


def test_stuck_process_is_joined_before_single_replacement_and_failed_replacement_stops(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "worker_main", sleeping_worker)

    async def scenario():
        manager = QuietSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        job_id = str(uuid4())
        await manager.reserve(job_id, "a" * 64, "ner", str(uuid4()), "1" * 64, ["phobert"], text="text")
        manager.active = job_id
        manager._spawn()
        manager.ready = True
        manager.active_since = time.monotonic() - jobs.TASK_TIMEOUT - 1
        original_pid = manager.process.pid
        manager.monitor = asyncio.create_task(manager._watch())
        try:
            await eventually(lambda: manager.process is not None and manager.process.pid != original_pid)
            with pytest.raises(ProcessLookupError):
                os.kill(original_pid, 0)
            replacement_pid = manager.process.pid
            result = await manager.get(job_id, "a" * 64)
            assert result["status"] == "failed" and result["errors"][0]["code"] == "TASK_TIMEOUT"
            # The watcher, not an injected incident, must notice the replacement
            # startup deadline and open the circuit instead of replacing twice.
            manager.started_at = time.monotonic() - jobs.STARTUP_TIMEOUT - 1
            await eventually(lambda: manager.disabled)
            with pytest.raises(ProcessLookupError):
                os.kill(replacement_pid, 0)
            assert manager.process is None
            assert all(status["status"] == "error" for status in manager.models.values())
        finally:
            await manager.close()
    asyncio.run(scenario())


def test_two_replacements_per_window_even_after_recovery(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "worker_main", ready_worker)

    async def scenario():
        manager = JobSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        try:
            await eventually(lambda: manager.ready)
            for _ in range(2):
                pid = manager.process.pid
                manager.process.kill()
                await eventually(lambda: manager.ready and manager.process is not None and manager.process.pid != pid)
                assert not manager.disabled
            manager.process.kill()
            await eventually(lambda: manager.disabled)
            assert manager.process is None
        finally:
            await manager.close()
    asyncio.run(scenario())


@pytest.mark.skipif(sys.platform != "linux" or not shutil.which("ffmpeg"), reason="Linux ffmpeg required")
@pytest.mark.parametrize("leader_dies_first", [False, True])
def test_shutdown_and_worker_loss_reap_real_decoder_group(tmp_path, monkeypatch, leader_dies_first):
    monkeypatch.setattr(jobs, "worker_main", decoder_worker)

    async def scenario():
        original_subreaper = subreaper_state()
        parent_group = os.getpgrp()
        child_file = tmp_path / "decoder.pid"
        manager = JobSupervisor(tmp_path, child_file, tmp_path / "uploads")
        await manager.start()
        child_pid = None
        try:
            await eventually(lambda: child_file.exists() and bool(child_file.read_text()))
            child_pid = int(child_file.read_text())
            await eventually(lambda: Path(f"/proc/{child_pid}/comm").read_text().strip() == "ffmpeg")
            leader_pid = manager.process.pid
            assert os.getpgid(leader_pid) == leader_pid
            assert os.getpgid(child_pid) == leader_pid
            assert leader_pid != parent_group
            if leader_dies_first:
                # A crash bypasses decoder finally blocks entirely. Replacement
                # cannot report readiness until the orphan group is gone.
                monkeypatch.setattr(jobs, "worker_main", ready_worker)
                manager.process.kill()
                await eventually(lambda: manager.ready)
                assert manager.process.pid != leader_pid
            else:
                await manager.close()
            with pytest.raises(ProcessLookupError):
                os.kill(child_pid, 0)
            with pytest.raises(ProcessLookupError):
                os.killpg(leader_pid, 0)
            assert os.getpgrp() == parent_group
        finally:
            await manager.close()
            # Keep a failing pre-fix run from leaking its real decoder.
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        assert subreaper_state() == original_subreaper
    asyncio.run(scenario())


@pytest.mark.skipif(sys.platform != "linux", reason="Linux subreaper required")
def test_close_immediately_after_spawn_restores_process_state(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "worker_main", sleeping_worker)

    async def scenario():
        original_subreaper = subreaper_state()
        parent_group = os.getpgrp()
        manager = JobSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        pid = manager.process.pid
        # No event-loop yield before close: spawn may not have reached setsid.
        await manager.close()
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)
        assert os.getpgrp() == parent_group
        assert subreaper_state() == original_subreaper
    asyncio.run(scenario())


def test_unconfirmed_group_cleanup_disables_replacement_and_close_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "worker_main", ready_worker)

    async def scenario():
        manager = JobSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        try:
            await eventually(lambda: manager.ready)
            pid = manager.process.pid
            real_killpg = os.killpg

            def denied_group_signal(pgid, sig):
                if pgid == pid and sig:
                    raise PermissionError("simulated OS denial")
                return real_killpg(pgid, sig)

            with monkeypatch.context() as patch:
                patch.setattr(os, "killpg", denied_group_signal)
                manager.ready = False
                manager.started_at = time.monotonic() - jobs.STARTUP_TIMEOUT - 1
                await eventually(lambda: manager.disabled)
                assert manager.process.pid == pid
                assert manager.process.is_alive()
                with pytest.raises(RuntimeError):
                    await manager.close()
                assert manager.process.pid == pid
            await manager.close()
            with pytest.raises(ProcessLookupError):
                os.kill(pid, 0)
        finally:
            await manager.close()
    asyncio.run(scenario())


class ClinicalPayload(dict):
    """Weak-referenceable IPC payload for observing actual data reachability."""


class ObservedSupervisor(QuietSupervisor):
    def _event(self, event):
        if event["type"] == "asr":
            self.result_reference = weakref.ref(event["value"])
        return super()._event(event)


@pytest.mark.parametrize("ending", ["done", "channel_error", "cancel"])
def test_idle_watcher_releases_expired_entry_and_last_clinical_event(tmp_path, ending):
    async def scenario():
        manager = ObservedSupervisor(tmp_path, tmp_path / "manifest.json", tmp_path / "uploads")
        await manager.start()
        job_id = str(uuid4())
        await manager.reserve(job_id, "a" * 64, "audio", str(uuid4()), "0" * 64, ["phobert"])
        manager.entries[job_id].descriptor["status"] = "running"
        manager.active = job_id
        manager.active_since = time.monotonic()
        manager.events, writer = manager.ctx.Pipe(duplex=False)
        reader = manager.events
        entry_reference = weakref.ref(manager.entries[job_id])
        text = "Bệnh nhân đau đầu."
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        writer.send({"type": "asr", "job_id": job_id, "audio": None,
                     "value": ClinicalPayload(raw_text=text, text_sha256=text_hash)})
        if ending == "channel_error":
            manager.replacements.extend([time.monotonic(), time.monotonic()])
            writer.close()
        else:
            writer.send({"type": "done", "job_id": job_id})
        manager.monitor = asyncio.create_task(manager._watch())
        try:
            await eventually(lambda: manager.entries[job_id].terminal_at is not None)
            retained = await manager.get(job_id, "a" * 64)
            assert retained["result"]["asr"]["raw_text"] == text
            assert retained["result"]["text_sha256"] == text_hash
            assert entry_reference() is not None and manager.result_reference() is not None
            if ending == "cancel":
                manager.monitor.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await manager.monitor
            manager.entries[job_id].terminal_at = time.monotonic() - jobs.RETENTION - 1
            if ending == "cancel":
                with pytest.raises(jobs.ApiFailure) as expired:
                    await manager.get(job_id, "a" * 64)
                assert expired.value.status == 404
            else:
                await eventually(lambda: job_id not in manager.entries)
            gc.collect()
            assert entry_reference() is None
            assert manager.result_reference() is None
        finally:
            await manager.close()
            writer.close()
            reader.close()
    asyncio.run(scenario())
