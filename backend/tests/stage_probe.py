import sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import accomp, mixer
from app.wavio import write_wav, read_wav
code = Path(sys.argv[1]).read_text(encoding="utf-8")
accomp.validate_code(code, 90)
t=time.time(); ev = accomp.query_events(code, 6 * 240 / 90); t1=time.time()
print("events", len(ev), "query", round(t1-t,1), "s")
a = accomp.render(ev, 90, 6); print("render", round(time.time()-t1,1), "s", a.shape, "rms", np.sqrt((a**2).mean()).round(3), "peak", abs(a).max().round(2))
write_wav(Path(sys.argv[2]), a * 0.8)
v, sr = read_wav(Path(sys.argv[3])); print("vocal", v.shape, sr)
vs, as_ = mixer.prepare_stems(v, a, 16.0)
m = mixer.mix(vs, as_); write_wav(Path(sys.argv[4]), m, {"ICMT": "test"})
print("mix peak", abs(m).max().round(3), "rms", np.sqrt((m**2).mean()).round(3))
