"""Minimal 16-bit PCM WAV writer with a LIST/INFO chunk carrying the AI-synthesis label."""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

from .config import SAMPLE_RATE


def _info_chunk(tags: dict[str, str]) -> bytes:
    body = b"INFO"
    for key, value in tags.items():
        data = value.encode("utf-8") + b"\0"
        if len(data) % 2:
            data += b"\0"
        body += key.encode("ascii") + struct.pack("<I", len(data)) + data
    return b"LIST" + struct.pack("<I", len(body)) + body


def write_wav(path: Path, audio: np.ndarray, tags: dict[str, str] | None = None, sr: int = SAMPLE_RATE) -> None:
    """audio: float array shaped (n,) or (n, channels), range -1..1."""
    if audio.ndim == 1:
        audio = audio[:, None]
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    channels = pcm.shape[1]
    data = pcm.tobytes()
    fmt = struct.pack("<HHIIHH", 1, channels, sr, sr * channels * 2, channels * 2, 16)
    info = _info_chunk(tags) if tags else b""
    riff_size = 4 + (8 + len(fmt)) + len(info) + (8 + len(data))
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", riff_size) + b"WAVE")
        f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt)
        f.write(info)
        f.write(b"data" + struct.pack("<I", len(data)) + data)


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    import wave

    with wave.open(str(path), "rb") as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        raw = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768.0
    return (raw.reshape(-1, ch) if ch > 1 else raw), sr
