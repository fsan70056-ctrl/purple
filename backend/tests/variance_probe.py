import sys, time, wave, json
from pathlib import Path
import numpy as np, onnxruntime as ort
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.lyrics import parse_lyrics, load_pinyin_dict
from app.config import singer_dir, FRAME_SEC
from app.song import Song, build_notes
from app.singer import QixuanSinger, midi_to_hz
d = load_pinyin_dict(singer_dir())
r = parse_lyrics("晚风吹过熟悉的街道，月光照着回家的方向", d)
s = Song(90, "C", "major", [0, 5, 3, 4], 6, "", "t", r.lines, seed=12); build_notes(s)
sg = QixuanSinger(); sg.load()
vdir = sg.dir / "dsvariance"
vt = json.loads((vdir / "0102_qixuan_muon1_multivar.phonemes.json").read_text())
same = all(vt.get(k) == v for k, v in sg.tokens.items() if k in vt); print("token ids same:", same, len(vt), len(sg.tokens))
so = ort.SessionOptions(); so.log_severity_level = 3
ling = ort.InferenceSession(str(vdir / "0102_qixuan_muon1_multivar.qixuan.linguistic.onnx"), so, providers=["CPUExecutionProvider"])
var = ort.InferenceSession(str(vdir / "0102_qixuan_muon1_multivar.qixuan.variance.onnx"), so, providers=["CPUExecutionProvider"])
notes = [n for n in s.notes if n.line == 0]
segs, starts, base = sg.layout(notes)
toks=[];langs=[];durs=[]
for sym, ln in segs:
    t,l = sg._token(sym); toks.append(vt.get(sym, t)); langs.append(l); durs.append(max(1,ln))
total = sum(durs)
f0 = sg.f0_curve(notes, starts, total)
midi = 69 + 12*np.log2(f0/440.0)
enc = ling.run(None, {"tokens": np.array([toks]), "languages": np.array([langs]), "ph_dur": np.array([durs])})[0]
z = np.zeros((1,total), np.float32)
t0=time.time()
b, v = var.run(None, {"encoder_out": enc, "ph_dur": np.array([durs]), "pitch": midi[None].astype(np.float32), "breathiness": z, "voicing": z, "retake": np.ones((1,total,2), bool), "steps": np.array(10, np.int64)})
print("variance", round(time.time()-t0,1), "s")
for nm, a in (("breath", b[0]), ("voicing", v[0])):
    print(nm, "min", a.min().round(1), "mean", a.mean().round(1), "max", a.max().round(1))
print("by seg:", [(sym, round(float(v[0][st:st+ln].mean()),1), round(float(b[0][st:st+ln].mean()),1)) for (sym,ln),st in zip(segs, np.cumsum([0]+[x for _,x in segs])[:-1])][:12])
