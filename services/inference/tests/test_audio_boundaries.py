from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import shutil
import struct
import wave
import threading

import pytest

from vodoco_inference.audio import decode_audio
from vodoco_inference.errors import InferenceError

pytestmark = pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg and ffprobe required",
)


def write_wav(path, frames, rate=16000):
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\0\0" * frames)


def test_thirty_second_boundary_is_decoded_without_trimming(tmp_path):
    path = tmp_path / "upload"
    write_wav(path, 30 * 16000)
    result = decode_audio(path)
    assert result.metadata["duration_seconds"] == 30
    assert result.samples.shape == (480000,)
    assert result.metadata["original_sample_rate"] == 16000
    write_wav(path, 30 * 16000 + 1)
    with pytest.raises(InferenceError) as error:
        decode_audio(path)
    assert error.value.code == "AUDIO_TOO_LONG"


def test_nonfinite_float_audio_is_rejected(tmp_path):
    path = tmp_path / "nan-upload"
    samples = struct.pack("<f", float("nan")) * 1600
    fmt = struct.pack("<HHIIHH", 3, 1, 16000, 64000, 4, 32)
    payload = b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(samples)) + samples
    path.write_bytes(b"RIFF" + struct.pack("<I", len(payload) + 4) + b"WAVE" + payload)
    with pytest.raises(InferenceError) as error:
        decode_audio(path)
    assert error.value.code == "AUDIO_INVALID"


def test_playlist_and_symlink_are_not_media_inputs(tmp_path):
    playlist = tmp_path / "upload"
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as listener:
        thread = threading.Thread(target=listener.serve_forever, daemon=True)
        thread.start()
        playlist.write_text(f"#EXTM3U\nhttp://127.0.0.1:{listener.server_port}/private.wav\n")
        try:
            with pytest.raises(InferenceError):
                decode_audio(playlist)
        finally:
            listener.shutdown()
            thread.join(timeout=2)
        assert requests == []
    link = tmp_path / "link"
    link.symlink_to(playlist)
    with pytest.raises(InferenceError) as error:
        decode_audio(link)
    assert error.value.code == "AUDIO_INVALID"
