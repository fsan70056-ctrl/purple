"""Single-worker job queue: progress, cancellation, errors, per-stage timings and resource metrics."""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import traceback
import uuid
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import accomp as accomp_mod
from . import mixer
from .config import AI_LABEL, MAX_DURATION_SECONDS, MAX_LYRICS_CHARS, MIN_FREE_MEMORY_MB, OUTPUT_DIR, SAMPLE_RATE, singer_dir
from .lyrics import load_pinyin_dict, parse_lyrics
from .metrics import ResourceSampler, system_available_mb
from .singer import Cancelled, QixuanSinger
from .song import Song, build_notes, plan_bars
from .wavio import read_wav, write_wav

JOB_ID = re.compile(r"^[0-9a-f]{32}$")
MAX_WAITING = 2
KEEP_JOBS = 8


class Busy(Exception):
    pass


@dataclass
class Job:
    id: str
    request: dict[str, Any]
    state: str = "queued"  # queued | running | done | failed | cancelled
    stage: str = "queued"
    percent: float = 0.0
    message: str = "排队中"
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
    song: dict[str, Any] | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    timings: dict[str, float] = field(default_factory=dict)
    cancel_flag: threading.Event = field(default_factory=threading.Event)
    procs: list = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        end = self.finished or time.time()
        return {
            "id": self.id,
            "state": self.state,
            "stage": self.stage,
            "percent": round(self.percent, 1),
            "message": self.message,
            "error": self.error,
            "warnings": self.warnings,
            "elapsed_seconds": round(end - self.started, 1) if self.started else 0,
            "timings": {k: round(v, 2) for k, v in self.timings.items()},
            "metrics": self.metrics,
            "song": self.song,
            "audio": ["mix", "vocal", "accomp"] if self.state == "done" else [],
            "ai_label": AI_LABEL,
        }

    @property
    def dir(self) -> Path:
        return OUTPUT_DIR / self.id


class JobManager:
    def __init__(self) -> None:
        self.jobs: "OrderedDict[str, Job]" = OrderedDict()
        self.queue: deque[Job] = deque()
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.singer: QixuanSinger | None = None
        self.pinyin: dict[str, list[str]] | None = None
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        threading.Thread(target=self._worker, daemon=True, name="song-worker").start()

    # ---------------------------------------------------------------- public API
    def submit(self, request: dict[str, Any]) -> Job:
        with self.lock:
            running = any(j.state == "running" for j in self.jobs.values())
            if len(self.queue) >= MAX_WAITING or (running and len(self.queue) >= MAX_WAITING):
                raise Busy("已有任务在生成，请等待完成或取消后再试")
            job = Job(id=uuid.uuid4().hex, request=request)
            self.jobs[job.id] = job
            self.queue.append(job)
            self._prune()
        self.wake.set()
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id) if JOB_ID.match(job_id) else None

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if not job:
            return None
        with self.lock:
            if job.state == "queued":
                job.state, job.stage, job.message = "cancelled", "cancelled", "已取消"
                job.finished = time.time()
                try:
                    self.queue.remove(job)
                except ValueError:
                    pass
            elif job.state == "running":
                job.cancel_flag.set()
                job.message = "正在取消…（当前这一句合成结束后停止）"
                for proc in job.procs:
                    try:
                        proc.kill()
                    except Exception:
                        pass
        return job

    # ---------------------------------------------------------------- internals
    def _prune(self) -> None:
        done = [j for j in self.jobs.values() if j.state in ("done", "failed", "cancelled")]
        for job in done[:-KEEP_JOBS] if len(done) > KEEP_JOBS else []:
            shutil.rmtree(job.dir, ignore_errors=True)
            self.jobs.pop(job.id, None)

    def _worker(self) -> None:
        while True:
            self.wake.wait()
            while True:
                with self.lock:
                    job = self.queue.popleft() if self.queue else None
                    if job is None:
                        self.wake.clear()
                        break
                self._run(job)
            # nothing queued: release model memory (the sessions are ~1 GB on a 16 GB machine)
            if self.singer:
                self.singer.unload()

    def _set(self, job: Job, stage: str, percent: float, message: str) -> None:
        job.stage, job.percent, job.message = stage, percent, message
        if job.cancel_flag.is_set():
            raise Cancelled()

    def _run(self, job: Job) -> None:
        job.state, job.started = "running", time.time()
        sampler = ResourceSampler()
        sampler.start()
        try:
            free = system_available_mb()
            if free < MIN_FREE_MEMORY_MB:
                raise RuntimeError(f"可用内存只有 {free:.0f} MB，低于 {MIN_FREE_MEMORY_MB} MB，请先关闭其他程序")
            self._pipeline(job)
            job.state, job.stage, job.percent, job.message = "done", "done", 100.0, "完成"
        except Cancelled:
            job.state, job.stage, job.message = "cancelled", "cancelled", "已取消"
            shutil.rmtree(job.dir, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001 - reported to the UI, details to the log
            traceback.print_exc()
            job.state, job.stage = "failed", "failed"
            job.error = str(exc) or exc.__class__.__name__
            job.message = "生成失败"
        finally:
            job.metrics = sampler.finish()
            job.finished = time.time()
            job.timings["total"] = job.finished - (job.started or job.finished)
            self._write_report(job)

    def _write_report(self, job: Job) -> None:
        if job.state != "done":
            return
        (job.dir / "report.json").write_text(json.dumps(job.public(), ensure_ascii=False, indent=2), encoding="utf-8")

    def _pipeline(self, job: Job) -> None:
        req = job.request
        comp = req["composition"]
        job.dir.mkdir(parents=True, exist_ok=True)

        # ---- 1. plan: lyrics, shared song structure, melody
        t = time.perf_counter()
        self._set(job, "plan", 2, "解析歌词、规划旋律")
        if self.pinyin is None:
            self.pinyin = load_pinyin_dict(singer_dir())
        lyr = parse_lyrics(req["lyrics"], self.pinyin, MAX_LYRICS_CHARS)
        job.warnings.extend(lyr.warnings)
        bpm = int(comp["bpm"])
        bars = plan_bars(lyr.lines, req["duration_seconds"], bpm, MAX_DURATION_SECONDS)
        song = Song(
            bpm=bpm, root=comp["root"], mode=comp["mode"], progression=list(comp["progression"]),
            total_bars=bars, accomp_code=comp["code"], title=comp.get("title", "") or "未命名歌曲",
            lines=lyr.lines, seed=int(req.get("seed", 0)),
        )
        accomp_mod.validate_code(song.accomp_code, bpm)
        build_notes(song)
        job.song = song.to_dict()
        job.timings["plan"] = time.perf_counter() - t

        # ---- 2. accompaniment: Strudel events (Node) -> numpy synth
        t = time.perf_counter()
        self._set(job, "accomp", 5, "渲染伴奏（Strudel 事件 → 音频）")
        events = accomp_mod.query_events(song.accomp_code, bars * song.bar_sec, proc_holder=job.procs)
        self._set(job, "accomp", 14, "合成伴奏音色")
        accomp_audio = accomp_mod.render(events, bpm, bars, seed=song.seed + 1)
        job.timings["accomp"] = time.perf_counter() - t

        # ---- 3. vocal: headless DiffSinger, one lyric line at a time
        t = time.perf_counter()
        self._set(job, "vocal", 18, "载入绮萱声库与声码器")
        if self.singer is None:
            self.singer = QixuanSinger()
        self.singer.load()
        job.timings["model_load"] = time.perf_counter() - t
        t = time.perf_counter()

        def progress(done: int, total: int) -> None:
            self._set(job, "vocal", 22 + 70 * done / total, f"合成人声 第 {done}/{total} 句")

        self._set(job, "vocal", 22, f"合成人声 第 0/{len(lyr.lines)} 句")
        vocal = self.singer.synth(song.notes, progress=progress, cancelled=job.cancel_flag.is_set)
        job.timings["vocal"] = time.perf_counter() - t

        # ---- 4. mix + export
        t = time.perf_counter()
        self._set(job, "mix", 93, "自动混音（音量平衡、闪避、淡入淡出）")
        vocal_stem, accomp_stem = mixer.prepare_stems(vocal, accomp_audio, song.duration)
        final = mixer.mix(vocal_stem, accomp_stem)
        tags = {"INAM": song.title, "ISFT": "Purple local song backend", "ICMT": AI_LABEL}
        write_wav(job.dir / "vocal.wav", vocal_stem, tags)
        write_wav(job.dir / "accomp.wav", accomp_stem, tags)
        write_wav(job.dir / "mix.wav", final, tags)
        (job.dir / "song.json").write_text(json.dumps(job.song, ensure_ascii=False, indent=2), encoding="utf-8")
        job.timings["mix"] = time.perf_counter() - t

    # ---------------------------------------------------------------- remix with custom volumes
    def remix_bytes(self, job: Job, vocal_gain: float, accomp_gain: float) -> bytes:
        import io

        v, _ = read_wav(job.dir / "vocal.wav")
        a, _ = read_wav(job.dir / "accomp.wav")
        out = mixer.mix(v, a, vocal_gain, accomp_gain)
        tmp = job.dir / "_remix.wav"
        write_wav(tmp, out, {"INAM": (job.song or {}).get("title", ""), "ICMT": AI_LABEL})
        data = tmp.read_bytes()
        tmp.unlink(missing_ok=True)
        return data
