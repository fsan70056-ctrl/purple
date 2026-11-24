"""Local song-generation API. Binds to 127.0.0.1 only; browser access limited to the local Purple origins."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from .config import (
    ALLOWED_HOSTS, ALLOWED_ORIGINS, AI_LABEL, HOST, MAX_CODE_CHARS, MAX_DURATION_SECONDS, MAX_LYRICS_CHARS,
    PORT, singer_dir,
)
from .accomp import validate_code
from .jobs import Busy, JobManager
from .lyrics import load_pinyin_dict, parse_lyrics
from .song import INTRO_BARS, OUTRO_BARS, ROOT_PC, SCALES, plan_bars

app = FastAPI(title="Purple local song backend", docs_url=None, redoc_url=None, openapi_url=None)
manager: JobManager | None = None


def jobs() -> JobManager:
    global manager
    if manager is None:
        manager = JobManager()
    return manager


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = (request.headers.get("host") or "").lower()
    if host not in ALLOWED_HOSTS:  # blocks DNS-rebinding style access
        return JSONResponse({"detail": "forbidden host"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:  # blocks cross-site POSTs from other web pages
        return JSONResponse({"detail": "forbidden origin"}, status_code=403)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"]
)


class CompositionIn(BaseModel):
    code: str = Field(max_length=MAX_CODE_CHARS)
    bpm: int = Field(ge=60, le=180)
    root: str
    mode: str
    progression: list[int] = Field(min_length=1, max_length=8)
    title: str = Field(default="", max_length=60)


class SongRequest(BaseModel):
    lyrics: str = Field(min_length=1, max_length=MAX_LYRICS_CHARS)
    singer: str = "qixuan"
    duration_seconds: int = Field(ge=8, le=MAX_DURATION_SECONDS)
    composition: CompositionIn
    seed: int = 0


class PreviewRequest(BaseModel):
    lyrics: str = Field(max_length=MAX_LYRICS_CHARS)
    duration_seconds: int = Field(default=15, ge=8, le=MAX_DURATION_SECONDS)
    bpm: int = Field(default=90, ge=60, le=180)


@app.get("/api/health")
def health() -> dict:
    try:
        singer_dir()
        ready = True
    except FileNotFoundError:
        ready = False
    return {"ok": True, "singer_ready": ready, "max_duration_seconds": MAX_DURATION_SECONDS, "concurrency": 1}


@app.get("/api/singers")
def singers() -> list[dict]:
    return [
        {
            "id": "qixuan",
            "name": "绮萱",
            "language": "中文",
            "engine": "DiffSinger（CPU，本机）",
            "available": True,
            "license": "仅个人研究；公开发布须标注 AI 合成并署名「绮萱」「DiffSinger」。",
            "ai_label": AI_LABEL,
        }
    ]


@app.post("/api/lyrics/preview")
def lyrics_preview(body: PreviewRequest) -> dict:
    try:
        parsed = parse_lyrics(body.lyrics, load_pinyin_dict(singer_dir()), MAX_LYRICS_CHARS)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    try:
        bars = plan_bars(parsed.lines, body.duration_seconds, body.bpm, MAX_DURATION_SECONDS)
    except ValueError as exc:
        return {
            "lines": [{"text": l.text, "syllables": [{"char": s.char, "pinyin": s.pinyin} for s in l.syllables]} for l in parsed.lines],
            "warnings": parsed.warnings,
            "problems": [str(exc)],
            "bars": 0,
            "actual_seconds": 0,
            "requested_seconds": body.duration_seconds,
        }
    actual = bars * 240 / body.bpm
    vocal_bars = bars - INTRO_BARS - OUTRO_BARS
    per_line = vocal_bars // len(parsed.lines)
    return {
        "lines": [{"text": l.text, "syllables": [{"char": s.char, "pinyin": s.pinyin} for s in l.syllables]} for l in parsed.lines],
        "warnings": parsed.warnings,
        "problems": [],
        "bars": bars,
        "vocal_bars": vocal_bars,
        "bars_per_line": per_line,
        "chars_per_line_max": per_line * 8,
        "actual_seconds": round(actual, 1),
        "requested_seconds": body.duration_seconds,
        "extended": bars > max(INTRO_BARS + OUTRO_BARS + 1, round(body.duration_seconds * body.bpm / 240)),
    }


@app.post("/api/songs", status_code=202)
def create_song(body: SongRequest) -> dict:
    comp = body.composition
    if body.singer != "qixuan":
        raise HTTPException(400, "未知的虚拟歌手")
    if comp.root not in ROOT_PC or comp.mode not in SCALES or any(not 0 <= d <= 6 for d in comp.progression):
        raise HTTPException(400, "调性或和弦参数无效")
    try:
        validate_code(comp.code, comp.bpm)  # reject anything but a plain pattern before it reaches Node
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    try:
        job = jobs().submit(body.model_dump())
    except Busy as exc:
        raise HTTPException(429, str(exc))
    return job.public()


def _job(job_id: str):
    job = jobs().get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    return _job(job_id).public()


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str) -> dict:
    job = jobs().cancel(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job.public()


@app.get("/api/jobs/{job_id}/audio/{name}.wav")
def job_audio(job_id: str, name: str):
    job = _job(job_id)
    if name not in ("mix", "vocal", "accomp") or job.state != "done":
        raise HTTPException(404, "音频未就绪")
    return FileResponse(job.dir / f"{name}.wav", media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/api/jobs/{job_id}/download.wav")
def job_download(job_id: str, vocal: float = 1.0, accomp: float = 1.0):
    job = _job(job_id)
    if job.state != "done":
        raise HTTPException(404, "音频未就绪")
    vocal, accomp = max(0.0, min(2.0, vocal)), max(0.0, min(2.0, accomp))
    data = jobs().remix_bytes(job, vocal, accomp)
    return Response(
        data, media_type="audio/wav", headers={"Content-Disposition": f'attachment; filename="purple-song-{job.id[:8]}.wav"'}
    )


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, workers=1, log_level="info")


if __name__ == "__main__":
    main()
