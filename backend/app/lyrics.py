"""Lyrics -> lines -> syllables -> Qixuan phonemes (via the voicebank's own pinyin dictionary)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_SPLIT = re.compile(r"[\n\r，。！？；、,.!?;:：\s]+")
_CJK = re.compile(r"[一-鿿]")


@dataclass
class Syllable:
    char: str
    pinyin: str
    phonemes: list[str]


@dataclass
class LyricLine:
    text: str
    syllables: list[Syllable] = field(default_factory=list)


@dataclass
class LyricsResult:
    lines: list[LyricLine]
    warnings: list[str]


def load_pinyin_dict(singer_dir: Path) -> dict[str, list[str]]:
    """Pinyin -> phonemes from the voicebank's own zh dictionary.

    The file is ~1.1M lines (it also holds English words), but the pinyin entries come first, so we
    stream-parse only until the first entry containing '/' instead of loading all of it as YAML."""
    entries: dict[str, list[str]] = {}
    grapheme: str | None = None
    with open(singer_dir / "dsdur" / "dsdict-zh.yaml", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if line.startswith("- grapheme:"):
                grapheme = line.split(":", 1)[1].strip()
                if "/" in grapheme:
                    break
                entries[grapheme] = []
            elif grapheme and line.startswith("  - ") and grapheme in entries:
                entries[grapheme].append(line[4:].strip())
    entries = {k: v for k, v in entries.items() if v}
    if len(entries) < 400:
        raise RuntimeError("拼音词典读取异常")
    return entries


def to_pinyin(char: str) -> str | None:
    from pypinyin import Style, pinyin  # imported lazily so tests of other modules need not have it

    result = pinyin(char, style=Style.NORMAL, v_to_u=False, errors="ignore", strict=False)
    return result[0][0] if result and result[0] else None


def parse_lyrics(text: str, pinyin_dict: dict[str, list[str]], max_chars: int = 400) -> LyricsResult:
    if len(text) > max_chars:
        raise ValueError(f"歌词过长（{len(text)} 字，上限 {max_chars}）")
    warnings: list[str] = []
    lines: list[LyricLine] = []
    skipped = set()
    for raw in _SPLIT.split(text.strip()):
        if not raw:
            continue
        line = LyricLine(text="")
        for ch in raw:
            if not _CJK.match(ch):
                skipped.add(ch)
                continue
            py = to_pinyin(ch)
            phonemes = pinyin_dict.get(py or "")
            if not py or not phonemes:
                warnings.append(f"「{ch}」无法转换为拼音/音素，已跳过")
                continue
            line.syllables.append(Syllable(ch, py, phonemes))
            line.text += ch
        if line.syllables:
            lines.append(line)
    if skipped:
        warnings.append("已忽略非中文字符：" + "".join(sorted(skipped)))
    if not lines:
        raise ValueError("没有可演唱的中文歌词")
    return LyricsResult(lines, warnings)
