"""Accompaniment: query the Strudel pattern headlessly (Node), then synthesize its events in numpy.

The pattern text comes from the existing composer (packages/core/src/composer.ts); here we only
read its events (start/end in cycles, note, s, gain, lpf, ...) and render them with simple
oscillators/filters/envelopes that mimic the in-browser engine's built-in sounds. One cycle is
one bar, so the grid matches the vocal exactly.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

from .config import SAMPLE_RATE, STRUDEL_RUNTIME

SR = SAMPLE_RATE
_ALLOWED_IDENTS = {
    "stack", "n", "note", "s", "sound", "scale", "struct", "lpf", "hpf", "bpf", "room", "gain", "delay",
    "attack", "decay", "sustain", "release", "penv", "pdecay", "cpm", "x",
}
_STRING = re.compile(r'"([A-Za-z0-9 .,<>\[\]~:#*/_|!@\-]*)"')
_NOTE_RE = re.compile(r"^([a-gA-G])([#bs]*)(-?\d+)?$")
_PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def validate_code(code: str, bpm: int) -> None:
    """Only plain Strudel pattern chains are accepted: no JS beyond whitelisted calls (the backend
    evaluates this text in Node, so it must never run arbitrary code)."""
    if not code or len(code) > 8000:
        raise ValueError("伴奏代码为空或过长")
    stripped = _STRING.sub('""', code)
    if '"' in stripped.replace('""', ""):
        raise ValueError("伴奏代码含有不允许的字符串")
    if not re.fullmatch(r'[\sA-Za-z0-9_().,/*+\-"]*', stripped):
        raise ValueError("伴奏代码含有不允许的字符")
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", stripped):
        if ident not in _ALLOWED_IDENTS:
            raise ValueError(f"伴奏代码含有不支持的调用：{ident}")
    if f".cpm({bpm}/4)" not in code.replace(" ", ""):
        raise ValueError("伴奏代码的速度（.cpm）与歌曲 BPM 不一致")


def _node() -> str:
    found = shutil.which("node")
    if found:
        return found
    for guess in (r"C:\Program Files\nodejs\node.exe", "/usr/bin/node", "/usr/local/bin/node"):
        if Path(guess).exists():
            return guess
    raise FileNotFoundError("找不到 Node.js（伴奏引擎需要）")


def query_events(code: str, seconds: float, timeout: float = 60.0, proc_holder: list | None = None) -> list[dict]:
    script = STRUDEL_RUNTIME / "strudel_events.mjs"
    if not script.is_file():
        raise FileNotFoundError("Strudel 运行时未构建：请先运行 tools/build_strudel_runtime.py")
    proc = subprocess.Popen(
        [_node(), str(script), f"{seconds:.6f}"],
        cwd=str(STRUDEL_RUNTIME),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    if proc_holder is not None:
        proc_holder.append(proc)
    try:
        out, err = proc.communicate(code, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise RuntimeError("伴奏引擎超时")
    if proc.returncode != 0:
        raise RuntimeError("伴奏引擎出错：" + (err or "")[-300:])
    start = out.find("[")
    return json.loads(out[start:])


def note_freq(name) -> float:
    if isinstance(name, (int, float)):
        return 440.0 * 2 ** ((float(name) - 69) / 12)
    m = _NOTE_RE.match(str(name))
    if not m:
        raise ValueError(f"unknown note {name!r}")
    pc = _PC[m.group(1).lower()]
    for ch in m.group(2):
        pc += 1 if ch in "#s" else -1
    octave = int(m.group(3)) if m.group(3) is not None else 3
    return 440.0 * 2 ** ((12 * (octave + 1) + pc - 69) / 12)


def _osc(kind: str, freq_or_curve, n: int, rng: np.random.Generator) -> np.ndarray:
    if kind in ("white", "noise"):
        return rng.uniform(-1, 1, n).astype(np.float32)
    if np.ndim(freq_or_curve) == 0:
        phase = (np.arange(n) * (freq_or_curve / SR)) % 1.0
    else:
        phase = np.cumsum(freq_or_curve) / SR % 1.0
    if kind == "sine":
        return np.sin(2 * np.pi * phase).astype(np.float32)
    if kind == "sawtooth":
        return (2 * phase - 1).astype(np.float32)
    if kind == "square":
        return np.where(phase < 0.5, 1.0, -1.0).astype(np.float32)
    return (2 * np.abs(2 * phase - 1) - 1).astype(np.float32)  # triangle (default)


def _adsr(v: dict, gate: float) -> tuple[float, float, float, float]:
    a, d, s, r = (v.get(k) for k in ("attack", "decay", "sustain", "release"))
    if a is None and d is None and s is None and r is None:
        return 0.001, 0.05, 0.6, 0.01
    sustain = s if s is not None else (1.0 if (a is not None and d is None) or (a is None and d is None) else 0.0)
    return max(a or 0.0, 0.001), max(d or 0.0, 0.001), min(float(sustain), 1.0), max(r or 0.0, 0.01)


def _envelope(a: float, d: float, s: float, r: float, gate_n: int, total_n: int) -> np.ndarray:
    env = np.zeros(total_n, dtype=np.float32)
    an, dn = int(a * SR), int(d * SR)
    t = np.arange(gate_n)
    e = np.where(t < an, t / max(1, an), np.where(t < an + dn, 1 - (1 - s) * (t - an) / max(1, dn), s))
    env[:gate_n] = e
    level = float(e[-1]) if gate_n else 0.0
    rn = total_n - gate_n
    if rn > 0:
        env[gate_n:] = level * np.linspace(1, 0, rn, dtype=np.float32)
    return env


_IR_CACHE: dict = {}


def _biquad_ir(kind: str, cutoff: float, q: float, n: int = 4096) -> np.ndarray:
    key = (kind, round(cutoff), q)
    if key in _IR_CACHE:
        return _IR_CACHE[key]
    w0 = 2 * np.pi * min(cutoff, SR * 0.45) / SR
    alpha = np.sin(w0) / (2 * q)
    cosw = np.cos(w0)
    if kind == "lp":
        b = [(1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2]
    elif kind == "hp":
        b = [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2]
    else:  # band-pass, constant 0 dB peak gain
        b = [alpha, 0.0, -alpha]
    a0 = 1 + alpha
    a1, a2 = -2 * cosw / a0, (1 - alpha) / a0
    b0, b1, b2 = (x / a0 for x in b)
    ir = np.zeros(n)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        x0 = 1.0 if i == 0 else 0.0
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        ir[i] = y0
        x2, x1, y2, y1 = x1, x0, y1, y0
    _IR_CACHE[key] = ir.astype(np.float32)
    return _IR_CACHE[key]


def _fft_conv(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)].astype(np.float32)


def _reverb_ir(seconds: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * (6.9 / seconds))
    ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    # darken the tail a little
    ir = _fft_conv(ir.astype(np.float32), _biquad_ir("lp", 5000, 0.7))
    return (ir / np.sqrt(np.sum(ir**2))).astype(np.float32)


def render(events: list[dict], bpm: int, bars: int, tail_seconds: float = 2.0, seed: int = 1) -> np.ndarray:
    """Return stereo float32 (n, 2) accompaniment of bars*bar_sec + tail seconds.

    Event times from query_events are already in seconds: this Strudel build implements
    .cpm(x) as fast(x/60), so one query unit == one second and one bar == 240/bpm units."""
    cycle = 1.0
    bar_sec = 240.0 / bpm
    total = int((bars * bar_sec + tail_seconds) * SR)
    buses: dict[tuple, np.ndarray] = {}
    rng = np.random.default_rng(seed)
    for ev in events:
        v = ev["v"]
        kind = v.get("s", "triangle")
        gate = max(0.005, (ev["end"] - ev["start"]) * cycle)
        a, d, s, r = _adsr(v, gate)
        life = gate + r if s > 0 or True else gate
        if kind in ("white", "noise") or s == 0.0:
            life = min(life, a + d + r + 0.05) if s == 0.0 else life
        gate_n = min(int(gate * SR), int(life * SR))
        n = int(life * SR) + 1
        start_n = int(round(ev["start"] * cycle * SR))
        if start_n >= total:
            continue
        n = min(n, total - start_n)
        gate_n = min(gate_n, n)
        t = np.arange(n) / SR
        if kind in ("white", "noise"):
            sig = _osc(kind, 0.0, n, rng)
        else:
            f = note_freq(v.get("note", v.get("n", "c3")))
            if v.get("penv"):
                pdecay = float(v.get("pdecay") or 0.05)
                curve = f * 2.0 ** (float(v["penv"]) * np.exp(-t / pdecay) / 12.0)
                sig = _osc(kind, curve, n, rng)
            else:
                sig = _osc(kind, f, n, rng)
        sig = sig * _envelope(a, d, s, r, gate_n, n) * float(v.get("gain", 1.0))
        filt = None
        if v.get("cutoff"):
            filt = ("lp", float(v["cutoff"]))
        elif v.get("hcutoff"):
            filt = ("hp", float(v["hcutoff"]))
        elif v.get("bandf"):
            filt = ("bp", float(v["bandf"]))
        key = (filt, float(v.get("room", 0.0)), float(v.get("delay", 0.0)))
        buf = buses.setdefault(key, np.zeros(total, dtype=np.float32))
        buf[start_n : start_n + n] += sig.astype(np.float32)
    dry = np.zeros(total, dtype=np.float32)
    room_send = np.zeros(total, dtype=np.float32)
    delay_send = np.zeros(total, dtype=np.float32)
    for (filt, room, delay), buf in buses.items():
        if filt:
            kind, cutoff = filt
            buf = _fft_conv(buf, _biquad_ir(kind, cutoff, 1.0 if kind != "bp" else 1.0))
        dry += buf
        if room:
            room_send += buf * room
        if delay:
            delay_send += buf * delay
    left, right = dry.copy(), dry.copy()
    if room_send.any():
        wet = 0.55
        left += wet * _fft_conv(room_send, _reverb_ir(1.8, 11))
        right += wet * _fft_conv(room_send, _reverb_ir(1.8, 12))
    if delay_send.any():
        echo = np.zeros(total, dtype=np.float32)
        step = int(0.25 * SR)
        for k in range(1, 6):
            if k * step < total:
                echo[k * step :] += delay_send[: total - k * step] * (0.5 ** (k - 1))
        left += echo
        right += np.roll(echo, int(0.012 * SR))
    return np.stack([left, right], axis=1)
