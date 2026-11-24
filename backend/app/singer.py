"""Headless DiffSinger inference for the Qixuan voicebank (ONNX Runtime, CPU).

Replicates what OpenUtau's DiffSinger renderer feeds the acoustic model + vocoder, without any
GUI: tokens/languages/durations per phoneme, per-frame f0 and the neutral expression curves.
Models are read from voice-lab (never copied into the repo). CPU only; concurrency is the
caller's job (jobs.py runs one job at a time).
"""
from __future__ import annotations

import gc
import json
import os
from dataclasses import dataclass
from typing import Callable

import numpy as np
import yaml

from .config import FRAME_SEC, HOP, SAMPLE_RATE, singer_dir, vocoder_dir
from .song import Note

# Typical consonant lengths in frames (11.6 ms each): stops/affricates, fricatives, nasals+l, glides.
_FRAMES = {
    **{p: 7 for p in ("b", "p", "d", "t", "g", "k", "z", "c", "zh", "ch", "j", "q")},
    **{p: 9 for p in ("f", "s", "sh", "x", "h", "r")},
    **{p: 6 for p in ("m", "n", "l")},
    **{p: 4 for p in ("y", "w", "y0")},
}
HEAD_FRAMES = 5
TAIL_FRAMES = 8
DEPTH = 0.6
STEPS = 20  # same shallow-diffusion settings OpenUtau used in our manual test


class Cancelled(Exception):
    pass


@dataclass
class Phrase:
    audio: np.ndarray  # mono float32 at SAMPLE_RATE
    start_sample: int  # absolute position on the song timeline


def midi_to_hz(m):
    return 440.0 * np.power(2.0, (np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


class QixuanSinger:
    name = "绮萱 Qixuan"
    id = "qixuan"

    def __init__(self) -> None:
        self.dir = singer_dir()
        self.vocoder_dir = vocoder_dir()
        cfg = yaml.safe_load((self.dir / "dsconfig.yaml").read_text(encoding="utf-8"))
        self.tokens = json.loads((self.dir / cfg["phonemes"]).read_text(encoding="utf-8"))
        self.languages = json.loads((self.dir / cfg["languages"]).read_text(encoding="utf-8"))
        self.acoustic_path = self.dir / cfg["acoustic"]
        voc_cfg = yaml.safe_load((self.vocoder_dir / "vocoder.yaml").read_text(encoding="utf-8"))
        self.vocoder_path = self.vocoder_dir / voc_cfg["model"]
        assert cfg["sample_rate"] == SAMPLE_RATE and cfg["hop_size"] == HOP
        vdir = self.dir / "dsvariance"
        vcfg = yaml.safe_load((vdir / "dsconfig.yaml").read_text(encoding="utf-8"))
        self.var_tokens = json.loads((vdir / vcfg["phonemes"]).read_text(encoding="utf-8"))
        self.var_linguistic_path = vdir / vcfg["linguistic"]
        self.var_variance_path = vdir / vcfg["variance"]
        self._acoustic = None
        self._vocoder = None
        self._var_linguistic = None
        self._var_variance = None

    # ------------------------------------------------------------------ sessions
    def load(self) -> None:
        if self._acoustic is not None:
            return
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        opts.enable_cpu_mem_arena = False  # keeps peak memory lower on a 16 GB laptop
        opts.intra_op_num_threads = max(1, min(8, (os.cpu_count() or 4) // 2 or 1))
        self._acoustic = ort.InferenceSession(str(self.acoustic_path), opts, providers=["CPUExecutionProvider"])
        self._vocoder = ort.InferenceSession(str(self.vocoder_path), opts, providers=["CPUExecutionProvider"])
        self._var_linguistic = ort.InferenceSession(str(self.var_linguistic_path), opts, providers=["CPUExecutionProvider"])
        self._var_variance = ort.InferenceSession(str(self.var_variance_path), opts, providers=["CPUExecutionProvider"])

    def unload(self) -> None:
        self._acoustic = None
        self._vocoder = None
        self._var_linguistic = None
        self._var_variance = None
        gc.collect()

    # ------------------------------------------------------------------ phoneme layout
    def _token(self, symbol: str) -> tuple[int, int]:
        if symbol not in self.tokens:
            raise KeyError(f"phoneme {symbol} not in voicebank")
        lang = self.languages.get(symbol.split("/")[0], 0) if "/" in symbol else 0
        return int(self.tokens[symbol]), int(lang)

    @staticmethod
    def _frame(seconds: float) -> int:
        return int(round(seconds / FRAME_SEC))

    def layout(self, notes: list[Note]) -> tuple[list[tuple[str, int]], list[int], int]:
        """Return (phoneme, frames) segments, per-note start frame (relative), and the absolute base frame."""
        onsets = [self._frame(n.start) for n in notes]
        ends = [self._frame(n.end) for n in notes]
        cons_len: list[list[int]] = []
        for n in notes:
            cons = n.syllable.phonemes[:-1]
            cons_len.append([_FRAMES.get(p.split("/")[-1], 6) for p in cons])
        vowels = [[onsets[i], ends[i]] for i in range(len(notes))]
        cstarts: list[int] = []
        for i in range(len(notes)):
            need = sum(cons_len[i])
            prev_floor = vowels[i - 1][0] + 2 if i > 0 else -(10**9)
            cs = max(prev_floor, onsets[i] - need)
            if i > 0:
                vowels[i - 1][1] = min(vowels[i - 1][1], cs)
            cstarts.append(cs)
            if cs > onsets[i] - need and cons_len[i]:  # not enough room: squeeze consonants
                avail = max(len(cons_len[i]), onsets[i] - cs)
                scale = avail / max(1, need)
                cons_len[i] = [max(1, int(round(c * scale))) for c in cons_len[i]]
        base = cstarts[0] - HEAD_FRAMES
        segs: list[tuple[str, int]] = [("SP", HEAD_FRAMES)]
        cursor = cstarts[0]
        for i, n in enumerate(notes):
            if cstarts[i] > cursor:  # small gap inside a phrase
                segs.append(("SP", cstarts[i] - cursor))
                cursor = cstarts[i]
            pos = cursor
            for sym, ln in zip(n.syllable.phonemes[:-1], cons_len[i]):
                segs.append((sym, ln))
                pos += ln
            vstart = max(pos, onsets[i])
            vend = max(vowels[i][1], vstart + 2)
            segs.append((n.syllable.phonemes[-1], vend - pos))
            cursor = vend
        segs.append(("SP", TAIL_FRAMES))
        starts = [c - base for c in cstarts]
        return segs, starts, base

    # ------------------------------------------------------------------ pitch curve
    def f0_curve(self, notes: list[Note], starts: list[int], total: int) -> np.ndarray:
        midi = np.empty(total, dtype=np.float64)
        bounds = starts[1:] + [total]
        midi[: starts[0]] = notes[0].midi
        for note, s, e in zip(notes, starts, bounds):
            midi[s:e] = note.midi
        kernel = np.array([1, 2, 3, 2, 1], dtype=np.float64)
        kernel /= kernel.sum()
        midi = np.convolve(np.pad(midi, 2, mode="edge"), kernel, mode="valid")
        # gentle vibrato on long notes (>= 0.5 s): +-22 cents, 5.5 Hz, fades in after 0.25 s
        t = np.arange(total) * FRAME_SEC
        for note, s, e in zip(notes, starts, bounds):
            if note.end - note.start < 0.5:
                continue
            local = t[s:e] - s * FRAME_SEC
            ramp = np.clip((local - 0.25) / 0.2, 0.0, 1.0)
            midi[s:e] += 0.22 * ramp * np.sin(2 * np.pi * 5.5 * local)
        return midi_to_hz(midi).astype(np.float32)

    # ------------------------------------------------------------------ inference
    def synth_phrase(self, notes: list[Note]) -> Phrase:
        self.load()
        segs, starts, base = self.layout(notes)
        toks, langs, durs = [], [], []
        for sym, ln in segs:
            t, l = self._token(sym)
            toks.append(t)
            langs.append(l)
            durs.append(max(1, ln))
        total = int(sum(durs))
        f0 = self.f0_curve(notes, starts, total)
        zeros = np.zeros((1, total), dtype=np.float32)
        # Breathiness/voicing are dB curves the acoustic model expects (vowels ~ -20 dB voicing,
        # ~ -46 dB breathiness). Like OpenUtau we let the voicebank's variance model predict them;
        # feeding 0 dB makes the result ~20 dB too loud and clipped.
        var_tokens = np.array([[self.var_tokens.get(sym, self.tokens[sym]) for sym, _ in segs]], dtype=np.int64)
        var_durs = np.array([durs], dtype=np.int64)
        enc = self._var_linguistic.run(None, {"tokens": var_tokens, "languages": np.array([langs], dtype=np.int64), "ph_dur": var_durs})[0]
        midi = (69.0 + 12.0 * np.log2(f0 / 440.0)).astype(np.float32)[None, :]
        breath, voicing = self._var_variance.run(
            None,
            {
                "encoder_out": enc,
                "ph_dur": var_durs,
                "pitch": midi,
                "breathiness": zeros,
                "voicing": zeros,
                "retake": np.ones((1, total, 2), dtype=bool),
                "steps": np.array(10, dtype=np.int64),
            },
        )
        feed = {
            "tokens": np.array([toks], dtype=np.int64),
            "languages": np.array([langs], dtype=np.int64),
            "durations": np.array([durs], dtype=np.int64),
            "f0": f0[None, :],
            "breathiness": breath.astype(np.float32),
            "voicing": voicing.astype(np.float32),
            "gender": zeros,
            "velocity": np.ones((1, total), dtype=np.float32),
            "depth": np.array(DEPTH, dtype=np.float32),
            "steps": np.array(STEPS, dtype=np.int64),
        }
        mel = self._acoustic.run(None, feed)[0]
        wav = self._vocoder.run(None, {"mel": mel, "f0": f0[None, :]})[0][0].astype(np.float32)
        return Phrase(wav, base * HOP)

    def synth(
        self,
        notes: list[Note],
        progress: Callable[[int, int], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> np.ndarray:
        """Render all notes (one phrase per lyric line) onto one mono track on the song timeline."""
        groups: dict[int, list[Note]] = {}
        for n in notes:
            groups.setdefault(n.line, []).append(n)
        phrases: list[Phrase] = []
        keys = sorted(groups)
        for k, line in enumerate(keys):
            if cancelled and cancelled():
                raise Cancelled()
            phrases.append(self.synth_phrase(groups[line]))
            if progress:
                progress(k + 1, len(keys))
        end = max(p.start_sample + len(p.audio) for p in phrases)
        track = np.zeros(max(0, end), dtype=np.float32)
        for p in phrases:
            s = max(0, p.start_sample)
            track[s : s + len(p.audio)] += p.audio[: len(track) - s]
        return track
