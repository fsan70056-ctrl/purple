"""Automatic mix: level balance, light vocal reverb, gentle ducking, fades, peak safety."""
from __future__ import annotations

import numpy as np

from .config import SAMPLE_RATE
from .accomp import _fft_conv, _reverb_ir

SR = SAMPLE_RATE
VOCAL_TARGET_RMS = 0.12   # active-signal RMS (about -18 dBFS)
ACCOMP_TARGET_RMS = 0.055  # about -25 dBFS: the voice sits ~7 dB above the band
PEAK_CEILING = 0.89


def _active_rms(x: np.ndarray) -> float:
    mono = x if x.ndim == 1 else x.mean(axis=1)
    mask = np.abs(mono) > 0.02 * max(1e-9, np.abs(mono).max())
    return float(np.sqrt(np.mean(mono[mask] ** 2))) if mask.any() else 1e-9


def _smooth(x: np.ndarray, n: int) -> np.ndarray:
    """Centered moving average in O(N) (a 0.3 s window by direct convolution took ~1 min)."""
    n = max(1, n)
    half = n // 2
    c = np.concatenate(([0.0], np.cumsum(x, dtype=np.float64)))
    idx = np.arange(len(x))
    lo = np.clip(idx - half, 0, len(x))
    hi = np.clip(idx - half + n, 0, len(x))
    return ((c[hi] - c[lo]) / np.maximum(1, hi - lo)).astype(np.float32)


def prepare_stems(vocal: np.ndarray, accomp: np.ndarray, duration: float) -> tuple[np.ndarray, np.ndarray]:
    """Return level-balanced stems (n, 2) at the song length."""
    n = int(round(duration * SR))
    v = np.zeros(n, dtype=np.float32)
    v[: min(n, len(vocal))] = vocal[:n]
    a = np.zeros((n, 2), dtype=np.float32)
    a[: min(n, len(accomp))] = accomp[:n]
    v *= VOCAL_TARGET_RMS / _active_rms(v)
    a *= ACCOMP_TARGET_RMS / _active_rms(a)
    wet = _fft_conv(v, _reverb_ir(0.9, 21))
    vs = np.stack([v + 0.14 * wet, v + 0.14 * np.roll(wet, 137)], axis=1)
    return vs, a


def duck_curve(vocal: np.ndarray, depth_db: float = 2.5) -> np.ndarray:
    env = _smooth(np.abs(vocal.mean(axis=1)), int(0.12 * SR))
    active = np.clip(env / (0.5 * max(1e-9, env.max())), 0.0, 1.0)
    active = _smooth(active, int(0.3 * SR))
    return (10 ** (-depth_db * active / 20)).astype(np.float32)


def mix(vocal_stem: np.ndarray, accomp_stem: np.ndarray, vocal_gain: float = 1.0, accomp_gain: float = 1.0) -> np.ndarray:
    n = len(vocal_stem)
    duck = duck_curve(vocal_stem)[:, None]
    out = vocal_stem * vocal_gain + accomp_stem * duck * accomp_gain
    fade_in = int(0.15 * SR)
    out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    fade_out = min(n, int(1.6 * SR))
    out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None] ** 1.5
    peak = float(np.abs(out).max())
    if peak > PEAK_CEILING:
        out *= PEAK_CEILING / peak
    return out.astype(np.float32)
