"""Decode local uploads with a bounded, network-disabled ffmpeg subprocess."""

import json
import math
import os
import selectors
import stat
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .errors import InferenceError

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_SECONDS = 30
SAMPLE_RATE = 16000
MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE
DEMUXERS = "wav,mp3,mov,matroska,webm"


@dataclass(frozen=True)
class DecodedAudio:
    samples: np.ndarray
    metadata: dict


def _error(code, message):
    return InferenceError(code, message, "decoding")


def _bounded_process(command: list[str], limit: int, deadline: float, fd: int) -> bytes:
    process = None
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   stdin=subprocess.DEVNULL, pass_fds=(fd,))
        output = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise _error("AUDIO_DECODE_TIMEOUT", "Audio decoding exceeded its time limit.")
                events = selector.select(remaining)
                if not events:
                    raise _error("AUDIO_DECODE_TIMEOUT", "Audio decoding exceeded its time limit.")
                chunk = os.read(process.stdout.fileno(), min(65536, limit + 1 - len(output)))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > limit:
                    raise _error("AUDIO_TOO_LONG", "Decoded audio exceeds the permitted duration or output size.")
        try:
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as exc:
            raise _error("AUDIO_DECODE_TIMEOUT", "Audio decoding exceeded its time limit.") from exc
        if code != 0:
            raise _error("AUDIO_INVALID", "Audio could not be decoded safely.")
        return bytes(output)
    except FileNotFoundError as exc:
        raise _error("DECODER_UNAVAILABLE", "The audio decoder is unavailable.") from exc
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()


def decode_audio(path: Path) -> DecodedAudio:
    deadline = time.monotonic() + 15
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as exc:
        raise _error("AUDIO_INVALID", "Audio input is unavailable.") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_INPUT_BYTES:
            raise _error("AUDIO_SIZE_INVALID", "Audio must contain between 1 byte and 10 MiB.")
        # The descriptor is inherited; untrusted filenames never enter commands.
        # Only non-playlist local demuxers are enabled. MOV external data references
        # remain disabled (ffmpeg's enable_drefs=0 default).
        source = f"/proc/self/fd/{fd}"
        common = ["-v", "error", "-protocol_whitelist", "file,pipe",
                  "-format_whitelist", DEMUXERS, "-probesize", "1048576",
                  "-analyzeduration", "5000000"]
        probe = _bounded_process([
            "ffprobe", *common, "-show_entries",
            "format=format_name,duration:stream=codec_type,sample_rate,channels,duration",
            "-of", "json", source,
        ], 65536, deadline, fd)
        try:
            metadata = json.loads(probe)
            streams = [item for item in metadata["streams"] if item.get("codec_type") == "audio"]
            if len(streams) != 1:
                raise ValueError
            stream = streams[0]
            original_rate = int(stream["sample_rate"])
            original_channels = int(stream["channels"])
            if not 1 <= original_rate <= 192000 or not 1 <= original_channels <= 8:
                raise ValueError
            format_name = metadata["format"]["format_name"]
            if not set(format_name.split(",")) & set(DEMUXERS.split(",")):
                raise ValueError
            for duration in (metadata["format"].get("duration"), stream.get("duration")):
                if duration is not None and duration != "N/A":
                    seconds = float(duration)
                    if not math.isfinite(seconds) or seconds <= 0:
                        raise ValueError
                    if seconds > MAX_SECONDS:
                        raise _error("AUDIO_TOO_LONG", "Audio must be at most 30 seconds; it was not trimmed.")
        except (ValueError, TypeError, KeyError) as exc:
            raise _error("AUDIO_INVALID", "Audio metadata is invalid or unsupported.") from exc
        mov_options = ["-enable_drefs", "0", "-use_absolute_path", "0"] if "mov" in format_name else []
        raw = _bounded_process([
            "ffmpeg", "-nostdin", *common, *mov_options, "-i", source,
            "-map", "0:a:0", "-vn", "-sn", "-dn", "-threads", "1",
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
        ], MAX_SAMPLES * 4, deadline, fd)
        if not raw or len(raw) % 4:
            raise _error("AUDIO_INVALID", "Audio contains no valid decoded samples.")
        samples = np.frombuffer(raw, dtype="<f4")
        if not np.isfinite(samples).all():
            raise _error("AUDIO_INVALID", "Audio contains non-finite decoded samples.")
        return DecodedAudio(samples, {
            "duration_seconds": len(samples) / SAMPLE_RATE,
            "original_sample_rate": original_rate, "sample_rate": SAMPLE_RATE,
            "original_channels": original_channels, "channels": 1, "format": format_name,
        })
    except InferenceError:
        raise
    except OSError as exc:
        raise _error("AUDIO_INVALID", "Audio decoding failed.") from exc
    finally:
        os.close(fd)
