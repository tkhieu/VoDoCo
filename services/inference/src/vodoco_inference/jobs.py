"""Ephemeral bounded admission registry and single spawned-worker supervision."""
from __future__ import annotations

import asyncio
from collections import deque
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import hmac
import multiprocessing
import os
from pathlib import Path
import signal
import sys
import time

from .schemas import MODEL_IDS, RESULT_BYTES, TERMINAL, encoded, error
from .worker import worker_main, worker_process

UPLOAD_TIMEOUT = 60
QUEUE_TIMEOUT = 120
TASK_TIMEOUT = 180
STARTUP_TIMEOUT = 300
RETENTION = 900


def timestamp(epoch: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if epoch is None else epoch, timezone.utc).isoformat().replace("+00:00", "Z")


class ApiFailure(Exception):
    def __init__(self, status: int, issue: dict, *, close: bool = False):
        self.status = status
        self.issue = issue
        self.close = close
        super().__init__(issue["code"])


@dataclass
class Entry:
    descriptor: dict
    capability_hash: bytes
    fingerprint: tuple
    payload: dict
    admitted_at: float = field(default_factory=time.monotonic)
    queued_at: float | None = None
    terminal_at: float | None = None
    path: Path | None = None
    failure: dict | None = None


class JobSupervisor:
    def __init__(self, model_root: Path, manifest_path: Path, temp_root: Path):
        self.model_root = model_root
        self.manifest_path = manifest_path
        self.temp_root = temp_root
        self.entries: dict[str, Entry] = {}
        self.lock = asyncio.Lock()
        self.models = self._model_states("loading")
        self.ctx = multiprocessing.get_context("spawn")
        self.process = None
        self.commands = None
        self.events = None
        self.monitor = None
        self.ready = False
        self.stopping = False
        self.active: str | None = None
        self.active_since = 0.0
        self.started_at = 0.0
        self.replacements: deque[float] = deque()
        self.replacement_start = False
        self.disabled = False
        self._directory_lock = None
        self._subreaper_previous: int | None = None

    @staticmethod
    def _model_states(status: str, issue: dict | None = None) -> dict:
        return {name: {"status": status, "identity": None, "token_limit": None,
                       "supports_offsets": False, "error": issue} for name in MODEL_IDS}

    async def start(self) -> None:
        # This also rejects a mistaken --workers >1 on the same container.
        import fcntl
        self.temp_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._directory_lock = (self.temp_root / ".owner.lock").open("a")
        try:
            fcntl.flock(self._directory_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._directory_lock.close()
            self._directory_lock = None
            raise RuntimeError("Inference requires exactly one ASGI process") from None
        for path in self.temp_root.glob("*.upload"):
            path.unlink(missing_ok=True)
        self._spawn()
        self.monitor = asyncio.create_task(self._watch(), name="gpu-supervisor")

    def _spawn(self) -> None:
        self._adopt_descendants()
        self.ready = False
        self.models = self._model_states("loading")
        self.commands = self.ctx.Queue(maxsize=1)
        self.events, writer = self.ctx.Pipe(duplex=False)
        self.process = self.ctx.Process(
            target=worker_process,
            args=(worker_main, (self.commands, writer, str(self.model_root), str(self.manifest_path))),
            daemon=True,
        )
        self.process.start()
        writer.close()
        self.started_at = time.monotonic()

    def _adopt_descendants(self) -> None:
        if sys.platform != "linux" or self._subreaper_previous is not None:
            return
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        if libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0:  # PR_GET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), "Cannot inspect child subreaper")
        if not previous.value and libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), "Cannot adopt worker descendants")
        self._subreaper_previous = previous.value

    def _restore_subreaper(self) -> None:
        if self._subreaper_previous is None:
            return
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, self._subreaper_previous, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Cannot restore child subreaper")
        self._subreaper_previous = None

    @staticmethod
    def _signal_worker_group(pid: int, sig: int) -> None:
        # The group's ID is the spawned leader's PID, never the inherited ASGI
        # group. ESRCH is normal if close races spawn before setsid().
        if pid == os.getpgrp():
            raise RuntimeError("Refusing to signal the ASGI process group")
        with suppress(ProcessLookupError):
            os.killpg(pid, sig)

    @staticmethod
    def _group_exists(pid: int) -> bool:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return False
        return True

    async def _wait_for_group(self, process, deadline: float) -> bool:
        while True:
            # Only multiprocessing may reap its leader. Once joined, waitpid
            # is restricted to adopted descendants in this worker's group.
            process.join(timeout=0)
            if not process.is_alive():
                if sys.platform == "linux":
                    while time.monotonic() < deadline:
                        try:
                            reaped, _ = os.waitpid(-process.pid, os.WNOHANG)
                        except ChildProcessError:
                            break
                        if not reaped:
                            break
                if not self._group_exists(process.pid):
                    return True
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(0.02)

    async def _stop_process(self) -> bool:
        process = self.process
        self.ready = False
        if process is None:
            return True
        # A prior failed close restores process-wide state; retrying cleanup
        # must reacquire adoption before terminating any remaining leader.
        self._adopt_descendants()
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                self._signal_worker_group(process.pid, sig)
                # Before setsid(), only the leader exists. Signal its PID as well
                # to close the race between probing a not-yet-created group and
                # the child establishing that group.
                if process.is_alive():
                    with suppress(ProcessLookupError):
                        os.kill(process.pid, sig)
                if await self._wait_for_group(process, time.monotonic() + 5):
                    break
            else:
                return False
        except OSError:
            # Keep ownership and handles: a later close may retry, but no
            # replacement may become a second CUDA owner.
            return False
        process.close()
        self.process = None
        if self.commands is not None:
            self.commands.cancel_join_thread()
            self.commands.close()
        if self.events is not None:
            self.events.close()
        self.commands = self.events = None
        return True

    async def close(self) -> None:
        self.stopping = True
        if self.monitor is not None:
            self.monitor.cancel()
            await asyncio.gather(self.monitor, return_exceptions=True)
            self.monitor = None
        try:
            stopped = await self._stop_process()
        finally:
            self._restore_subreaper()
        if not stopped:
            self.disabled = True
            raise RuntimeError("Worker process group termination could not be confirmed")
        async with self.lock:
            for entry in self.entries.values():
                self._cleanup(entry)
            self.entries.clear()
        if self._directory_lock is not None:
            self._directory_lock.close()
            self._directory_lock = None

    @staticmethod
    def _cleanup(entry: Entry) -> None:
        if entry.path is not None:
            entry.path.unlink(missing_ok=True)
            entry.path = None
        entry.payload.clear()

    def _expire(self, now: float) -> None:
        for job_id, entry in list(self.entries.items()):
            if entry.terminal_at is not None and now - entry.terminal_at >= RETENTION:
                self._cleanup(entry)
                del self.entries[job_id]

    @staticmethod
    def _authorized(entry: Entry | None, token: str) -> bool:
        supplied = hashlib.sha256(token.encode("utf-8")).digest()
        expected = entry.capability_hash if entry is not None else bytes(32)
        return hmac.compare_digest(supplied, expected) and entry is not None

    async def get(self, job_id: str, token: str) -> dict:
        async with self.lock:
            self._expire(time.monotonic())
            entry = self.entries.get(job_id)
            if not self._authorized(entry, token):
                raise ApiFailure(404, error("JOB_UNAVAILABLE", "This job is unavailable."))
            # Serialized under the lock: callers receive a snapshot, not a mutable alias.
            return self._snapshot(entry)

    @staticmethod
    def _snapshot(entry: Entry) -> dict:
        import json
        return json.loads(encoded(entry.descriptor))

    async def reserve(self, job_id: str, token: str, kind: str, session_id: str,
                      input_hash: str, models: list[str], source: str = "raw", revision: int = 0,
                      text: str | None = None) -> tuple[dict, bool]:
        fingerprint = (kind, session_id, input_hash, tuple(sorted(models)), source, revision)
        async with self.lock:
            now = time.monotonic()
            self._expire(now)
            existing = self.entries.get(job_id)
            if existing is not None:
                if not self._authorized(existing, token):
                    raise ApiFailure(404, error("JOB_UNAVAILABLE", "This job is unavailable."), close=True)
                if existing.fingerprint != fingerprint:
                    raise ApiFailure(409, error("JOB_CONFLICT", "This job ID already identifies another request."), close=True)
                return self._snapshot(existing), False
            if sum(entry.terminal_at is None for entry in self.entries.values()) >= 3:
                raise ApiFailure(429, error("BUSY", "Inference capacity is currently full.", retryable=True), close=True)
            required_ready = self.models["asr"]["status"] == "ready" if kind == "audio" else any(
                self.models[model]["status"] == "ready" for model in models)
            if not self.ready or self.disabled or not required_ready:
                raise ApiFailure(503, error("MODEL_UNAVAILABLE", "The requested inference is not ready.", retryable=True), close=True)
            status = "receiving" if kind == "audio" else "queued"
            descriptor = {"api_version": "1", "job_id": job_id, "session_id": session_id,
                          "kind": kind, "status": status, "stage": status, "created_at": timestamp(),
                          "expires_at": None, "input_sha256": input_hash, "result": None, "errors": []}
            payload = {"job_id": job_id, "kind": kind, "models": sorted(models), "source": source,
                       "revision": revision}
            if text is not None:
                payload["text"] = text
            entry = Entry(descriptor, hashlib.sha256(token.encode("utf-8")).digest(), fingerprint, payload,
                          admitted_at=now, queued_at=now if kind == "ner" else None)
            if kind == "audio":
                entry.path = self.temp_root / f"{job_id}.upload"
                payload["path"] = str(entry.path)
            self.entries[job_id] = entry
            return self._snapshot(entry), True

    async def uploaded(self, job_id: str) -> dict:
        async with self.lock:
            entry = self.entries[job_id]
            if entry.descriptor["status"] == "receiving":
                entry.descriptor.update(status="queued", stage="queued")
                entry.queued_at = time.monotonic()
            return self._snapshot(entry)

    async def upload_failed(self, job_id: str) -> None:
        async with self.lock:
            entry = self.entries.get(job_id)
            if entry is not None and entry.descriptor["status"] == "receiving":
                self._finish(entry, error("UPLOAD_FAILED", "The upload did not complete verification.", "receiving", retryable=True))

    def _result(self, entry: Entry) -> dict:
        descriptor = entry.descriptor
        if descriptor["result"] is None:
            descriptor["result"] = {"audio": None, "asr": None, "ner": {},
                                    "source": entry.fingerprint[4], "revision": entry.fingerprint[5],
                                    "text_sha256": descriptor["input_sha256"] if descriptor["kind"] == "ner" else None}
        return descriptor["result"]

    def _finish(self, entry: Entry, issue: dict | None = None) -> None:
        descriptor = entry.descriptor
        if descriptor["status"] in TERMINAL:
            return
        result = descriptor["result"]
        if issue is not None:
            descriptor["errors"].append(issue)
        models = entry.fingerprint[3]
        # Fill only unfinished columns; never erase a completed successful column.
        if result is not None and result["text_sha256"] is not None:
            for model in models:
                if model not in result["ner"]:
                    failure = dict(issue or error("NER_FAILED", "Recognition did not complete.", "recognizing", retryable=True))
                    failure["model"] = model
                    result["ner"][model] = {"status": "failed", "source": result["source"],
                                            "revision": result["revision"], "text_sha256": result["text_sha256"],
                                            "model": self.models[model]["identity"], "entities": [],
                                            "error": failure, "duration_ms": 0}
            for outcome in result["ner"].values():
                if outcome["error"] is not None and outcome["error"] not in descriptor["errors"]:
                    descriptor["errors"].append(outcome["error"])
        succeeded = sum(outcome["status"] == "succeeded" for outcome in (result or {}).get("ner", {}).values())
        if descriptor["kind"] == "audio":
            usable = result is not None and result["asr"] is not None and bool(result["asr"]["raw_text"].strip())
            status = ("succeeded" if succeeded == len(models) and issue is None else "partial") if usable else "failed"
        else:
            status = "succeeded" if succeeded == len(models) and issue is None else ("partial" if succeeded else "failed")
        descriptor.update(status=status, stage="finished", expires_at=timestamp(time.time() + RETENTION))
        entry.terminal_at = time.monotonic()
        self._cleanup(entry)
        terminal = sorted((item for item in self.entries.items() if item[1].terminal_at is not None),
                          key=lambda item: item[1].terminal_at)
        for job_id, old in terminal[:-64]:
            self._cleanup(old)
            del self.entries[job_id]

    def _event(self, event: dict) -> bool:
        """Consume one ordered worker event. Return false for startup failure."""
        kind = event["type"]
        if kind == "model":
            self.models[event["model"]] = event["value"]
            return True
        if kind == "ready":
            self.ready = True
            self.replacement_start = False
            return True
        if kind == "startup_error":
            return False
        entry = self.entries.get(event.get("job_id"))
        if entry is None or event.get("job_id") != self.active:
            return True
        if entry.descriptor["status"] in TERMINAL:
            if kind in ("done", "failed"):
                self.active = None
            return True
        if entry.failure is not None and kind not in ("done", "failed"):
            return True
        if kind == "stage":
            entry.descriptor.update(status="running", stage=event["stage"])
        elif kind in ("asr", "ner"):
            result = self._result(entry)
            if kind == "asr":
                result.update(audio=event["audio"], asr=event["value"], text_sha256=event["value"]["text_sha256"])
            else:
                result["ner"][event["model"]] = event["value"]
            # Reserve headroom for timestamps and terminal/model-local errors.
            if len(encoded(entry.descriptor)) > RESULT_BYTES - 8192:
                issue = error("RESULT_TOO_LARGE", "The model result exceeds the response limit.", entry.descriptor["stage"])
                if kind == "asr":
                    result.update(audio=None, asr=None, text_sha256=None)
                    entry.failure = issue
                else:
                    model = event["model"]
                    issue["model"] = model
                    result["ner"][model] = {"status": "failed", "source": result["source"],
                                            "revision": result["revision"], "text_sha256": result["text_sha256"],
                                            "model": self.models[model]["identity"], "entities": [],
                                            "error": issue, "duration_ms": 0}
        elif kind in ("done", "failed"):
            self._finish(entry, event.get("error") or entry.failure)
            self.active = None
        return True

    async def _incident(self, code: str, message: str) -> None:
        issue = error(code, message, "worker", retryable=True)
        # Await confirmed death before releasing its active slot or spawning again.
        stopped = await self._stop_process()
        async with self.lock:
            if self.active is not None:
                entry = self.entries.get(self.active)
                if entry is not None:
                    if entry.descriptor["kind"] == "ner":
                        self._result(entry)
                    self._finish(entry, issue)
                self.active = None
            now = time.monotonic()
            while self.replacements and now - self.replacements[0] >= 600:
                self.replacements.popleft()
            if not stopped or self.replacement_start or len(self.replacements) >= 2:
                self.disabled = True
                self.models = self._model_states("error", error("WORKER_UNAVAILABLE", "The GPU worker requires operator recovery.", "worker"))
                for entry in list(self.entries.values()):
                    if entry.descriptor["status"] == "queued":
                        self._finish(entry, issue)
                return
            self.replacements.append(now)
            self.replacement_start = True
            self._spawn()

    async def _watch(self) -> None:
        while not self.stopping:
            await asyncio.sleep(0.05)
            incident = None
            entry = event = None
            try:
                async with self.lock:
                    now = time.monotonic()
                    self._expire(now)
                    for entry in list(self.entries.values()):
                        status = entry.descriptor["status"]
                        if status == "receiving" and now - entry.admitted_at >= UPLOAD_TIMEOUT:
                            self._finish(entry, error("UPLOAD_FAILED", "The upload exceeded its time budget.", "receiving", retryable=True))
                        elif status == "queued" and now - entry.queued_at >= QUEUE_TIMEOUT:
                            self._finish(entry, error("QUEUE_TIMEOUT", "The job exceeded its queue time budget.", "queued", retryable=True))
                    if self.events is not None:
                        for _ in range(32):
                            try:
                                if not self.events.poll():
                                    break
                                # A dead worker can leave a partial frame. Never read that
                                # frame on ASGI or wait on it past the transport budget.
                                event = await asyncio.wait_for(asyncio.to_thread(self.events.recv), 1)
                            except (EOFError, OSError, TimeoutError):
                                incident = ("WORKER_LOST", "The GPU worker event channel was interrupted.")
                                break
                            if not self._event(event):
                                incident = ("WORKER_STARTUP_FAILED", "The GPU worker could not initialize.")
                    if self.process is not None and not self.process.is_alive():
                        incident = ("WORKER_LOST", "The GPU worker stopped unexpectedly.")
                    elif self.process is not None and not self.ready and now - self.started_at >= STARTUP_TIMEOUT:
                        incident = ("WORKER_STARTUP_TIMEOUT", "The GPU worker exceeded its startup budget.")
                    elif self.active is not None and now - self.active_since >= TASK_TIMEOUT:
                        incident = ("TASK_TIMEOUT", "The inference task exceeded its time budget.")
                    if incident is None and self.ready and not self.disabled and self.active is None:
                        for job_id, entry in self.entries.items():
                            if entry.descriptor["status"] == "queued":
                                self.commands.put_nowait(entry.payload)
                                self.active = job_id
                                self.active_since = now
                                # Keep stage queued until the worker reports real execution.
                                entry.descriptor["status"] = "running"
                                break
                # No patient data should live in the idle monitor frame, even
                # while group cleanup awaits a dead worker or is cancelled.
                entry = event = None
                if incident is not None and not self.disabled:
                    await self._incident(*incident)
            finally:
                entry = event = None
