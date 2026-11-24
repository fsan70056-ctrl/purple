"""One shared song structure: BPM, key, chords, bars and the vocal note timeline.

Both the Strudel accompaniment (events queried per cycle) and the vocal (notes placed on the
same bar/slot grid) are derived from this object, so they cannot drift apart.
Grid: 4/4, 8 slots (eighth notes) per bar; one chord per bar; one Strudel cycle == one bar.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

from .lyrics import LyricLine, Syllable

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
}
ROOT_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SLOTS_PER_BAR = 8
INTRO_BARS = 1
OUTRO_BARS = 1


@dataclass
class Note:
    start: float  # seconds from song start
    end: float
    midi: int
    bar: int
    slot: int
    slots: int
    syllable: Syllable
    line: int


@dataclass
class Song:
    bpm: int
    root: str
    mode: str
    progression: list[int]  # scale degree of the chord root, one per bar, cycling
    total_bars: int
    accomp_code: str
    title: str
    lines: list[LyricLine]
    notes: list[Note] = field(default_factory=list)
    seed: int = 0

    @property
    def bar_sec(self) -> float:
        return 240.0 / self.bpm

    @property
    def beat_sec(self) -> float:
        return 60.0 / self.bpm

    @property
    def duration(self) -> float:
        return self.total_bars * self.bar_sec

    def chord_degree(self, bar: int) -> int:
        return self.progression[bar % len(self.progression)]

    def to_dict(self) -> dict[str, Any]:
        names = ["I", "II", "III", "IV", "V", "VI", "VII"]
        return {
            "bpm": self.bpm,
            "key": f"{self.root} {self.mode}",
            "progression": [names[d % 7] for d in self.progression],
            "bars": self.total_bars,
            "intro_bars": INTRO_BARS,
            "outro_bars": OUTRO_BARS,
            "bar_seconds": round(self.bar_sec, 4),
            "duration_seconds": round(self.duration, 3),
            "title": self.title,
            "seed": self.seed,
            "notes": [
                {
                    "char": n.syllable.char,
                    "pinyin": n.syllable.pinyin,
                    "start": round(n.start, 3),
                    "end": round(n.end, 3),
                    "midi": n.midi,
                    "bar": n.bar,
                    "slot": n.slot,
                }
                for n in self.notes
            ],
        }


def degree_to_midi(degree: int, mode: str, tonic: int) -> int:
    scale = SCALES[mode]
    return tonic + scale[degree % 7] + 12 * (degree // 7)


def tonic_midi(root: str) -> int:
    pc = ROOT_PC[root]
    # keep the tonic around D#4..B4 so degrees -1..7 stay inside a comfortable female range
    candidates = [pc + 12 * k for k in range(3, 7)]
    return min(candidates, key=lambda m: abs(m - 62))


def _durations(n: int, slots: int) -> list[int]:
    """Slot lengths for n syllables inside `slots`, keeping a breath at the end when possible."""
    spare = slots - n
    if spare < 0:
        raise ValueError(f"一句有 {n} 个字，但这一句只有 {slots} 个节拍格；请缩短歌词或增加时长")
    durs = [1] * n
    breath = 1 if spare >= 3 else 0
    extra = spare - breath
    order = [n - 1, n // 2, n // 4, (3 * n) // 4, n - 2, 0]
    order = [i for i in order if 0 <= i < n]
    guard = 0
    while extra > 0 and guard < 200:
        guard += 1
        for i in order:
            if extra <= 0:
                break
            cap = 4 if i == n - 1 else 3
            if durs[i] < cap:
                durs[i] += 1
                extra -= 1
        if all(durs[i] >= (4 if i == n - 1 else 3) for i in order) and extra > 0:
            # everything capped: give leftover to the final note anyway
            durs[n - 1] += extra
            extra = 0
    return durs


def plan_bars(lines: list[LyricLine], seconds: float, bpm: int, max_seconds: float) -> int:
    """Bars for the song: the requested length, extended when the lyrics would not fit.

    Every line gets the same number of bars (8 eighth-note slots each). If the longest line or
    the number of lines needs more room than the requested length offers, the song grows by
    whole bars (and the UI reports the real length) instead of squeezing syllables."""
    requested = max(INTRO_BARS + OUTRO_BARS + 1, round(seconds * bpm / 240))
    per_line_needed = max(math.ceil(len(line.syllables) / SLOTS_PER_BAR) for line in lines)
    needed = INTRO_BARS + OUTRO_BARS + per_line_needed * len(lines)
    bars = max(requested, needed)
    if bars * 240 / bpm > max_seconds + 1e-6:
        raise ValueError(
            f"这段歌词至少需要 {bars * 240 / bpm:.0f} 秒（上限 {max_seconds:.0f} 秒）；请减少句数或每句字数"
        )
    return bars


def build_notes(song: Song) -> None:
    """Fill song.notes from song.lines using the chord of each bar."""
    rng = random.Random(song.seed * 31 + len(song.lines))
    vocal_bars = song.total_bars - INTRO_BARS - OUTRO_BARS
    n_lines = len(song.lines)
    if vocal_bars < 1:
        raise ValueError("歌曲太短，放不下人声；请选择更长的时长")
    if n_lines > vocal_bars:
        raise ValueError(
            f"歌词有 {n_lines} 句，但 {song.duration:.0f} 秒的歌只能唱 {vocal_bars} 句；请减少句数或选更长时长"
        )
    per_line = vocal_bars // n_lines
    tonic = tonic_midi(song.root)
    prev_deg = 2
    for li, line in enumerate(song.lines):
        first_bar = INTRO_BARS + li * per_line
        slots = per_line * SLOTS_PER_BAR
        n = len(line.syllables)
        durs = _durations(n, slots)
        is_last_line = li == n_lines - 1
        peak = 4 + (1 if li % 2 == 1 else 0) + rng.choice([0, 1])
        pos = 0
        for i, syl in enumerate(line.syllables):
            bar = first_bar + pos // SLOTS_PER_BAR
            slot = pos % SLOTS_PER_BAR
            d = durs[i]
            p = i / max(1, n - 1)
            target = round(1 + (peak - 1) * math.sin(math.pi * min(1.0, p * 0.95)) + (0 if p < 0.9 else -1.5 * (p - 0.9) / 0.1))
            chord_root = song.chord_degree(bar)
            tones = [chord_root + k + 7 * o for k in (0, 2, 4) for o in (-1, 0, 1)]
            strong = slot % 4 == 0 or d >= 2 or i == n - 1
            last = i == n - 1
            if last:
                end_deg = 0 if is_last_line else (4 if li % 2 == 0 else 2)
                cands = [end_deg - 7, end_deg, end_deg + 7]
                deg = min((c for c in cands if -1 <= c <= 8), key=lambda c: abs(c - prev_deg))
            elif strong:
                deg = min((t for t in tones if -1 <= t <= 8 and abs(t - prev_deg) <= 4), key=lambda t: abs(t - target), default=prev_deg)
            else:
                step = max(-2, min(2, target - prev_deg))
                deg = prev_deg + (step if step != 0 else rng.choice([-1, 1]))
                deg = max(-1, min(8, deg))
            prev_deg = deg
            start = (bar * SLOTS_PER_BAR + slot) * song.beat_sec / 2
            end = start + d * song.beat_sec / 2
            song.notes.append(
                Note(start, end, degree_to_midi(deg, song.mode, tonic), bar, slot, d, syl, li)
            )
            pos += d
