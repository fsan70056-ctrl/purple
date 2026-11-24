"""Manual probe: synthesize the validated test lyric headlessly and report pitch accuracy + timing."""
import sys, time, wave
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.lyrics import parse_lyrics, load_pinyin_dict
from app.config import singer_dir
from app.song import Song, build_notes
from app.singer import QixuanSinger, midi_to_hz

def main(out):
    d = load_pinyin_dict(singer_dir())
    r = parse_lyrics("晚风吹过熟悉的街道，月光照着回家的方向", d)
    s = Song(90, "C", "major", [0, 5, 3, 4], 6, "", "t", r.lines, seed=12)
    build_notes(s)
    sg = QixuanSinger()
    t0 = time.time(); sg.load(); t1 = time.time()
    wav = sg.synth(s.notes)
    t2 = time.time()
    print(f"load {t1-t0:.1f}s synth {t2-t1:.1f}s audio {len(wav)/44100:.2f}s peak {abs(wav).max():.3f} rms {np.sqrt((wav**2).mean()):.3f}", flush=True)
    pcm = (np.clip(wav, -1, 1) * 32767).astype("<i2")
    w = wave.open(out, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100); w.writeframes(pcm.tobytes()); w.close()
    errs = []
    for n in s.notes:
        a = int((n.start + (n.end-n.start)*0.45) * 44100); b = int((n.start + (n.end-n.start)*0.85) * 44100)
        seg = wav[a:b]
        if len(seg) < 1500: continue
        seg = seg - seg.mean(); ac = np.correlate(seg, seg, "full")[len(seg)-1:]
        lo, hi = int(44100/900), int(44100/150)
        lag = lo + int(np.argmax(ac[lo:hi])); f = 44100/lag
        errs.append(1200*np.log2(f/ float(midi_to_hz(n.midi))))
    errs = np.array(errs); print("notes", len(errs), "median |cents|", np.median(abs(errs)).round(1), "max", abs(errs).max().round(1))
main(sys.argv[1])
