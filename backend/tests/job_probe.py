"""Runs a full job through JobManager (no HTTP) and prints stage timings + resource metrics."""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.jobs import JobManager
code = Path(sys.argv[1]).read_text(encoding="utf-8")
dur = int(sys.argv[2])
req = {"lyrics": sys.argv[3], "singer": "qixuan", "duration_seconds": dur, "seed": 12,
       "composition": {"code": code, "bpm": 90, "root": "C", "mode": "major", "progression": [0, 5, 3, 4], "title": "测试"}}
m = JobManager(); j = m.submit(req); last = None
while j.state in ("queued", "running"):
    cur = (j.stage, round(j.percent), j.message)
    if cur != last: print(cur, flush=True); last = cur
    time.sleep(0.5)
print(json.dumps({k: v for k, v in j.public().items() if k not in ("song",)}, ensure_ascii=False, indent=1))
