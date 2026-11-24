"""Targeted backend tests (stdlib unittest; no model needed except where noted).

Run:  .venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
"""
import io
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import accomp, mixer
from app.config import singer_dir
from app.lyrics import load_pinyin_dict, parse_lyrics
from app.song import INTRO_BARS, OUTRO_BARS, SCALES, Song, build_notes, degree_to_midi, plan_bars, tonic_midi
from app.wavio import read_wav, write_wav

CODE = Path(__file__).resolve().parent / "fixtures" / "lofi-calm-90bpm.strudel.txt"
GOOD_CODE = 'stack(n("<[0,2,4] [5,7,9]>").scale("C3:major").s("sawtooth").lpf(520).gain(0.14)).cpm(90/4)'


def song_for(text: str, bars: int, mode: str = "major", root: str = "C") -> Song:
    pinyin = load_pinyin_dict(singer_dir())
    lyr = parse_lyrics(text, pinyin)
    s = Song(90, root, mode, [0, 5, 3, 4], bars, GOOD_CODE, "t", lyr.lines, seed=3)
    build_notes(s)
    return s


class Lyrics(unittest.TestCase):
    def test_pinyin_and_phonemes(self):
        d = load_pinyin_dict(singer_dir())
        self.assertGreaterEqual(len(d), 600)
        r = parse_lyrics("晚风吹过，月光", d)
        self.assertEqual([l.text for l in r.lines], ["晚风吹过", "月光"])
        self.assertEqual(r.lines[0].syllables[0].phonemes, ["zh/w", "zh/uan"])
        self.assertEqual(parse_lyrics("女", d).lines[0].syllables[0].phonemes, ["zh/n", "zh/v"])

    def test_non_chinese_is_reported_not_sung(self):
        r = parse_lyrics("你好 abc 123", load_pinyin_dict(singer_dir()))
        self.assertEqual(r.lines[0].text, "你好")
        self.assertTrue(any("已忽略" in w for w in r.warnings))

    def test_empty_and_overlong_are_rejected(self):
        d = load_pinyin_dict(singer_dir())
        with self.assertRaises(ValueError):
            parse_lyrics("abc 123", d)
        with self.assertRaises(ValueError):
            parse_lyrics("啊" * 401, d)


class Melody(unittest.TestCase):
    def test_notes_share_the_bar_grid_and_stay_in_range(self):
        s = song_for("晚风吹过熟悉的街道，月光照着回家的方向", 6)
        beat = 60 / 90
        for n in s.notes:
            self.assertAlmostEqual(n.start, (n.bar * 8 + n.slot) * beat / 2, places=6)
            self.assertGreaterEqual(n.bar, INTRO_BARS)
            self.assertLess(n.end, (s.total_bars - OUTRO_BARS) * s.bar_sec + 1e-6)
            self.assertTrue(55 <= n.midi <= 84, n.midi)
        ends = [n.end for n in s.notes]
        starts = [n.start for n in s.notes]
        self.assertTrue(all(b >= a - 1e-9 for a, b in zip(ends, starts[1:])))  # no overlaps
        self.assertEqual(len(s.notes), 18)

    def test_every_note_is_in_the_key(self):
        for mode in SCALES:
            s = song_for("天空很高很远我在这里", 6, mode, "D")
            pcs = {(tonic_midi("D") + i) % 12 for i in SCALES[mode]}
            self.assertTrue(all(n.midi % 12 in pcs for n in s.notes), mode)

    def test_last_line_resolves_to_the_tonic(self):
        s = song_for("晚风吹过熟悉的街道，月光照着回家的方向", 6)
        self.assertEqual(s.notes[-1].midi % 12, tonic_midi("C") % 12)

    def test_too_many_lines_or_syllables_give_a_clear_error(self):
        with self.assertRaises(ValueError) as ctx:
            song_for("一二三四五六七八九，一二三四五六七八九，一二三四五六七八九", 6)  # 3 lines -> 1 bar (8 slots) each
        self.assertIn("个字", str(ctx.exception))
        with self.assertRaises(ValueError) as ctx2:
            song_for("甲，乙，丙，丁，戊，己", 6)
        self.assertIn("句", str(ctx2.exception))

    def test_song_grows_to_fit_the_lyrics_and_respects_the_cap(self):
        pinyin = load_pinyin_dict(singer_dir())
        two = parse_lyrics("晚风吹过熟悉的街道，月光照着回家的方向", pinyin).lines
        self.assertEqual(plan_bars(two, 15, 90, 60), 6)  # fits as requested
        self.assertEqual(plan_bars(two, 15, 80, 60), 6)  # 5 bars would be too short -> grows to 6 (18 s)
        long_lines = parse_lyrics("一二三四五六七八九，" * 12, pinyin).lines
        with self.assertRaises(ValueError):
            plan_bars(long_lines, 15, 90, 60)
        s = Song(80, "C", "major", [0, 5, 3, 4], plan_bars(two, 15, 80, 60), GOOD_CODE, "t", two)
        build_notes(s)
        self.assertEqual(len(s.notes), 18)

    def test_degree_mapping(self):
        self.assertEqual(degree_to_midi(0, "major", 60), 60)
        self.assertEqual(degree_to_midi(7, "major", 60), 72)
        self.assertEqual(degree_to_midi(-1, "major", 60), 59)


class CodeValidation(unittest.TestCase):
    def test_accepts_composer_style_code(self):
        accomp.validate_code(GOOD_CODE, 90)
        if CODE.exists():
            accomp.validate_code(CODE.read_text(encoding="utf-8"), 90)

    def test_rejects_anything_that_is_not_a_plain_pattern(self):
        bad = [
            'stack(n("0").s("sine")).cpm(90/4); process.exit()',
            'stack(constructor.constructor("return 1")()).cpm(90/4)',
            'stack(n("0").s("sine")).cpm(90/4)//x\nimport("fs")',
            'stack(n(`0`)).cpm(90/4)',
            'stack(n("0").s("sine").foo(1)).cpm(90/4)',
            'stack(n("0").s("sine")).cpm(120/4)',  # tempo does not match the song
            "",
        ]
        for code in bad:
            with self.assertRaises(ValueError, msg=code):
                accomp.validate_code(code, 90)


class AccompAndMix(unittest.TestCase):
    def test_event_times_are_seconds_on_the_bar_grid(self):
        ev = accomp.query_events(GOOD_CODE, 2 * 240 / 90)
        pads = sorted({round(e["start"], 3) for e in ev})
        self.assertEqual(pads[:2], [0.0, 2.667])  # one chord per bar
        a = accomp.render(ev, 90, 2)
        self.assertEqual(a.shape[1], 2)
        self.assertGreater(float(np.abs(a).max()), 0.01)
        first_half = float(np.abs(a[: int(2.6 * 44100)]).mean())
        self.assertGreater(first_half, 0.0)

    def test_mix_balances_levels_fades_and_never_clips(self):
        n = 44100 * 6
        t = np.arange(n) / 44100
        voice = (0.9 * np.sin(2 * np.pi * 440 * t) * (t > 1)).astype(np.float32)
        band = (np.random.default_rng(1).standard_normal((n, 2)) * 0.5).astype(np.float32)
        v, a = mixer.prepare_stems(voice, band, 6.0)
        out = mixer.mix(v, a)
        self.assertLessEqual(float(np.abs(out).max()), mixer.PEAK_CEILING + 1e-4)
        self.assertLess(float(np.abs(out[:50]).max()), 0.05)  # fade in
        self.assertLess(float(np.abs(out[-200:]).max()), 0.02)  # fade out
        louder = mixer.mix(v, a, vocal_gain=1.5, accomp_gain=0.5)
        self.assertGreater(float(np.abs(louder).max()), 0)

    def test_wav_roundtrip_keeps_the_ai_label(self):
        import tempfile

        x = (np.random.default_rng(2).uniform(-0.5, 0.5, (4410, 2))).astype(np.float32)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.wav"
            write_wav(p, x, {"ICMT": "AI 合成人声：绮萱"})
            y, sr = read_wav(p)
            self.assertEqual(sr, 44100)
            self.assertEqual(y.shape, x.shape)
            self.assertLess(float(np.abs(y - x).max()), 2e-4)
            self.assertIn("AI 合成人声".encode("utf-8"), p.read_bytes())


if __name__ == "__main__":
    unittest.main()
