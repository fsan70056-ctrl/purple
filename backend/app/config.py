"""Paths and limits. Models live in voice-lab (outside the repo) and are never committed."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
OUTPUT_DIR = Path(os.environ.get("PURPLE_OUTPUT_DIR", BACKEND_DIR / "output")).resolve()
STRUDEL_RUNTIME = BACKEND_DIR / ".strudel-runtime"

HOST = "127.0.0.1"
PORT = int(os.environ.get("PURPLE_BACKEND_PORT", "8765"))
# Browsers may only call the API from these origins (the local Purple preview / dev server).
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "PURPLE_ALLOWED_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:4173,http://localhost:4173,"
        "http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    if o.strip()
]
ALLOWED_HOSTS = {"127.0.0.1", "localhost", f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

SAMPLE_RATE = 44100
HOP = 512
FRAME_SEC = HOP / SAMPLE_RATE

MAX_DURATION_SECONDS = 60  # hard cap for this validation stage; tested at 15 and 30 s
MAX_LYRICS_CHARS = 400
MAX_CODE_CHARS = 8000
MIN_FREE_MEMORY_MB = 1200  # refuse to start a job below this (16 GB machine, ~3 GB free seen)


def find_voice_lab() -> Path:
    env = os.environ.get("PURPLE_VOICE_LAB")
    if env:
        return Path(env).resolve()
    for parent in [REPO_ROOT, *REPO_ROOT.parents]:
        candidate = parent / "voice-lab"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("voice-lab directory not found; set PURPLE_VOICE_LAB")


def singer_dir() -> Path:
    base = find_voice_lab() / "openutau" / "Singers"
    for p in sorted(base.glob("Qixuan*")):
        if (p / "dsconfig.yaml").is_file():
            return p
    raise FileNotFoundError(f"Qixuan voicebank not found under {base}")


def vocoder_dir() -> Path:
    base = find_voice_lab() / "openutau" / "Dependencies"
    for p in sorted(base.glob("pc_nsf_hifigan*")):
        if (p / "vocoder.yaml").is_file():
            return p
    raise FileNotFoundError(f"vocoder not found under {base}")


AI_LABEL = "AI 合成人声：绮萱（Qixuan）· DiffSinger；声码器 PC-NSF-HiFiGAN（OpenVPI，CC BY-NC-SA 4.0）。仅限个人研究，公开发布须标注 AI 合成并署名。"
