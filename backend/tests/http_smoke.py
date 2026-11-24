"""End-to-end acceptance run against the RUNNING local backend (127.0.0.1:8765).

Covers: security checks, a 15 s song, queue limit + cancel, a 30 s song; checks the audio for real
(duration, level, vocal pitch vs the planned melody, alignment) and records timings + resources.
Run with the backend venv:  .venv\\Scripts\\python.exe tests\\http_smoke.py
"""
import http.client, json, shutil, sys, time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.wavio import read_wav
from app.singer import midi_to_hz

HOST, PORT = "127.0.0.1", 8765
ORIGIN = "http://127.0.0.1:3000"
CODE = (ROOT / "tests" / "fixtures" / "lofi-calm-90bpm.strudel.txt").read_text(encoding="utf-8")
LY15 = "晚风吹过熟悉的街道，月光照着回家的方向"
LY30 = "晚风吹过熟悉的街道，月光照着回家的方向，我在路灯下等你，心里装满了温柔"
OUT = ROOT.parent.parent.parent / "voice-lab" / "work"
results = {"checks": []}


def call(method, path, body=None, headers=None, raw=False):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=60)
    h = {"Origin": ORIGIN}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    conn.request(method, path, data, h)
    r = conn.getresponse()
    payload = r.read()
    conn.close()
    return r.status, (payload if raw else (json.loads(payload) if payload[:1] in b"{[" else payload))


def check(name, ok, detail=""):
    results["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def request(seconds, lyrics, seed=12):
    return {"lyrics": lyrics, "singer": "qixuan", "duration_seconds": seconds, "seed": seed,
            "composition": {"code": CODE, "bpm": 90, "root": "C", "mode": "major", "progression": [0, 5, 3, 4], "title": "验收"}}


def wait(job_id, until=("done", "failed", "cancelled"), timeout=400, stage=None):
    t0, seen = time.time(), []
    while time.time() - t0 < timeout:
        st, j = call("GET", f"/api/jobs/{job_id}")
        key = (j["stage"], int(j["percent"] // 10))
        if not seen or seen[-1] != key:
            seen.append(key)
        if j["state"] in until or (stage and j["stage"] == stage):
            return j, seen
        time.sleep(0.5)
    raise TimeoutError(job_id)


def pitch_report(vocal, notes):
    errs = []
    for n in notes:
        a = int((n["start"] + (n["end"] - n["start"]) * 0.45) * 44100)
        b = int((n["start"] + (n["end"] - n["start"]) * 0.85) * 44100)
        seg = vocal[a:b] - vocal[a:b].mean()
        if len(seg) < 1500:
            continue
        ac = np.correlate(seg, seg, "full")[len(seg) - 1:]
        lo, hi = int(44100 / 900), int(44100 / 150)
        f = 44100 / (lo + int(np.argmax(ac[lo:hi])))
        errs.append(abs(1200 * np.log2(f / float(midi_to_hz(n["midi"])))))
    errs = np.array(errs)
    return len(errs), float(np.median(errs)), float((errs < 50).mean())


def run_song(tag, seconds, lyrics):
    t0 = time.time()
    st, j = call("POST", "/api/songs", request(seconds, lyrics))
    check(f"{tag}: accepted", st == 202, st)
    jid = j["id"]
    j, seen = wait(jid)
    wall = time.time() - t0
    check(f"{tag}: finished", j["state"] == "done", j.get("error"))
    if j["state"] != "done":
        return None
    stages = [s for s, _ in seen]
    check(f"{tag}: progress was reported live through accomp>vocal", all(s in stages for s in ("accomp", "vocal")), stages)
    song = j["song"]
    files = {}
    for name in ("mix", "vocal", "accomp"):
        st, data = call("GET", f"/api/jobs/{jid}/audio/{name}.wav", raw=True)
        (OUT / f"song-{tag}-{name}.wav").write_bytes(data)
        files[name] = read_wav(OUT / f"song-{tag}-{name}.wav")
    mix, sr = files["mix"]
    check(f"{tag}: mix is stereo 44.1k and as long as the song", sr == 44100 and mix.shape[1] == 2 and abs(len(mix) / sr - song["duration_seconds"]) < 0.05, f"{len(mix)/sr:.2f}s")
    check(f"{tag}: mix peak <= 0.9 (no clipping)", float(np.abs(mix).max()) <= 0.9, f"{float(np.abs(mix).max()):.3f}")
    vocal = files["vocal"][0].mean(axis=1)
    n, med, frac = pitch_report(vocal, song["notes"])
    check(f"{tag}: sung melody matches the plan", n >= 0.9 * len(song["notes"]) and med < 30 and frac >= 0.85, f"{n} notes, median {med:.1f} cents, {frac*100:.0f}% within 50c")
    first = float(np.argmax(np.abs(vocal) > 0.02 * np.abs(vocal).max())) / 44100
    check(f"{tag}: vocal enters after the intro bar", first >= song["bar_seconds"] - 0.25, f"first sound {first:.2f}s, bar {song['bar_seconds']:.2f}s")
    st, rm = call("GET", f"/api/jobs/{jid}/download.wav?vocal=0.4&accomp=1.0", raw=True)
    (OUT / f"song-{tag}-remix-vocal40.wav").write_bytes(rm)
    check(f"{tag}: independent volume remix works", st == 200 and rm[:4] == b"RIFF" and len(rm) > 100000, len(rm))
    results[tag] = {"wall_seconds": round(wall, 1), "timings": j["timings"], "metrics": j["metrics"],
                    "song": {k: song[k] for k in ("bpm", "key", "bars", "duration_seconds", "progression")}, "pitch_median_cents": round(med, 1)}
    print(json.dumps(results[tag], ensure_ascii=False, indent=1), flush=True)
    return jid


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    st, h = call("GET", "/api/health"); check("health", st == 200 and h["singer_ready"], h)
    st, s = call("GET", "/api/singers"); check("singers lists 绮萱 with AI label", st == 200 and s[0]["name"] == "绮萱" and "AI 合成" in s[0]["ai_label"])
    # security
    st, _ = call("GET", "/api/health", headers={"Origin": "http://evil.example"}); check("foreign Origin is rejected", st == 403, st)
    st, _ = call("GET", "/api/health", headers={"Host": "evil.example"}); check("foreign Host header is rejected", st == 403, st)
    bad = request(15, LY15); bad["composition"]["code"] = 'stack(n("0")).cpm(90/4); process.exit()'
    st, _ = call("POST", "/api/songs", bad); check("code injection is refused before Node", st == 400, st)
    st, _ = call("GET", "/api/jobs/../../etc/passwd"); check("path traversal job id -> 404", st in (404, 400), st)
    st, _ = call("GET", "/api/jobs/" + "0" * 32 + "/audio/mix.wav"); check("unknown job -> 404", st == 404, st)
    st, p = call("POST", "/api/lyrics/preview", {"lyrics": LY15, "duration_seconds": 15, "bpm": 90}); check("lyrics preview", st == 200 and len(p["lines"]) == 2 and not p["problems"], p.get("actual_seconds"))

    run_song("15s", 15, LY15)

    # queue limit + cancel: A runs, B and C wait, D is refused; cancel everything
    ids = []
    for i in range(4):
        st, j = call("POST", "/api/songs", request(15, LY15, seed=i))
        ids.append((st, j.get("id")))
        time.sleep(0.3)
    check("only 1 running + 2 waiting (4th refused with 429)", [s for s, _ in ids] == [202, 202, 202, 429], [s for s, _ in ids])
    a = ids[0][1]
    j, _ = wait(a, stage="vocal", until=("failed", "done", "cancelled"))
    t0 = time.time(); call("POST", f"/api/jobs/{a}/cancel")
    j, _ = wait(a, until=("cancelled", "done", "failed"), timeout=120)
    check("running job can be cancelled", j["state"] == "cancelled", f"{j['state']} after {time.time()-t0:.1f}s")
    for _, i in ids[1:3]:
        call("POST", f"/api/jobs/{i}/cancel")
    for _, i in ids[1:3]:
        wait(i, until=("cancelled", "done", "failed"), timeout=120)
    check("cancelled job leaves no audio", call("GET", f"/api/jobs/{a}/audio/mix.wav", raw=True)[0] == 404)

    run_song("30s", 30, LY30)
    ok = all(c["ok"] for c in results["checks"])
    results["all_passed"] = ok
    (ROOT / "tests" / "http_smoke_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("ALL PASSED" if ok else "SOME FAILED", flush=True)


try:
    main()
except Exception as exc:  # noqa
    import traceback; traceback.print_exc()
    results["crash"] = repr(exc)
    (ROOT / "tests" / "http_smoke_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print("FINISHED", flush=True)
