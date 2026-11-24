import { useCallback, useEffect, useRef, useState } from 'react'
import { composeSong, type Genre, type Instrument, type Mood } from '@purple/core/composer'

/**
 * "歌曲" mode: sends lyrics + the existing composer's accompaniment (code, key, chords) to the
 * local Python backend, which sings the lyrics with an offline CPU voice model and mixes the
 * result. The backend is reached through the same-origin dev/preview proxy (/local-song-api),
 * so the page's Content-Security-Policy is unchanged and nothing leaves this computer.
 */

const API = '/local-song-api/api'
const SONG_SECONDS = [15, 30] as const
const POLL_MS = 700

interface Singer {
  id: string
  name: string
  language: string
  engine: string
  available: boolean
  license: string
  ai_label: string
}

interface LyricsPreview {
  lines: { text: string; syllables: { char: string; pinyin: string }[] }[]
  warnings: string[]
  problems: string[]
  bars: number
  vocal_bars?: number
  bars_per_line?: number
  chars_per_line_max?: number
  actual_seconds: number
  requested_seconds: number
  extended?: boolean
}

interface JobMetrics {
  cpu_avg_percent_of_machine?: number
  cpu_peak_percent_of_machine?: number
  cpu_avg_cores_busy?: number
  logical_cores?: number
  python_working_set_peak_mb?: number
  system_available_min_mb?: number
}

interface Job {
  id: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  stage: string
  percent: number
  message: string
  error: string | null
  warnings: string[]
  elapsed_seconds: number
  timings: Record<string, number>
  metrics: JobMetrics
  song: { bpm: number; key: string; bars: number; duration_seconds: number } | null
  ai_label: string
}

type Backend = 'checking' | 'ready' | 'offline'

const STAGE_LABEL: Record<string, string> = {
  queued: '排队',
  plan: '规划旋律',
  accomp: '渲染伴奏',
  vocal: '合成人声',
  mix: '混音导出',
  done: '完成',
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init)
  if (!response.ok) {
    let detail = `请求失败（${response.status}）`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

export function SongMode(props: {
  genre: Genre
  mood: Mood
  bpm: number
  instruments: readonly Instrument[]
  onBeforeGenerate: () => void
}) {
  const { genre, mood, bpm, instruments, onBeforeGenerate } = props
  const [backend, setBackend] = useState<Backend>('checking')
  const [singers, setSingers] = useState<Singer[]>([])
  const [singerId, setSingerId] = useState('qixuan')
  const [lyrics, setLyrics] = useState('晚风吹过熟悉的街道，\n月光照着回家的方向')
  const [seconds, setSeconds] = useState<(typeof SONG_SECONDS)[number]>(15)
  const [preview, setPreview] = useState<LyricsPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vocalVol, setVocalVol] = useState(100)
  const [accompVol, setAccompVol] = useState(100)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [remixing, setRemixing] = useState(false)
  const jobIdRef = useRef<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const busy = job !== null && (job.state === 'queued' || job.state === 'running')
  const effectiveBpm = bpm

  const checkBackend = useCallback(async () => {
    setBackend('checking')
    try {
      await api('/health')
      setSingers(await api<Singer[]>('/singers'))
      setBackend('ready')
    } catch {
      setBackend('offline')
    }
  }, [])

  useEffect(() => {
    void checkBackend()
  }, [checkBackend])

  // Debounced lyric check: pinyin, per-line capacity, and "too many lines for this length".
  useEffect(() => {
    if (backend !== 'ready') return
    const handle = window.setTimeout(() => {
      api<LyricsPreview>('/lyrics/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics, duration_seconds: seconds, bpm: effectiveBpm }),
      })
        .then((value) => {
          setPreview(value)
          setPreviewError(null)
        })
        .catch((failure: unknown) => {
          setPreview(null)
          setPreviewError(failure instanceof Error ? failure.message : '歌词检查失败')
        })
    }, 400)
    return () => window.clearTimeout(handle)
  }, [backend, lyrics, seconds, effectiveBpm])

  // Poll the running job until it settles.
  useEffect(() => {
    if (!job || (job.state !== 'queued' && job.state !== 'running')) return
    const id = job.id
    const timer = window.setInterval(() => {
      api<Job>(`/jobs/${id}`)
        .then((next) => {
          if (jobIdRef.current === id) setJob(next)
        })
        .catch(() => setError('与本地后端的连接中断，请确认 run-backend.bat 仍在运行。'))
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [job])

  // When a job finishes, point the player at the finished mix.
  useEffect(() => {
    if (job?.state === 'done') {
      setVocalVol(100)
      setAccompVol(100)
      setAudioUrl(`${API}/jobs/${job.id}/audio/mix.wav?t=${Date.now()}`)
    }
  }, [job?.state, job?.id])

  // Stop a still-running job (and free its memory) when leaving the page.
  useEffect(
    () => () => {
      const id = jobIdRef.current
      if (id) void fetch(`${API}/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined)
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    },
    [],
  )

  const generate = async () => {
    setError(null)
    const usable = instruments.filter((item) => item !== 'lead')
    if (usable.length === 0) {
      setError('歌曲模式需要至少一种伴奏乐器（主旋律“主奏”会和人声抢位置，已自动排除）。')
      return
    }
    if (preview && preview.problems.length > 0) {
      setError(preview.problems[0] ?? '歌词不符合要求')
      return
    }
    onBeforeGenerate()
    const seed = Math.floor(Math.random() * 100000)
    const made = composeSong(
      { genre, mood, bpm, instruments: usable, durationSeconds: seconds },
      seed,
    )
    setAudioUrl(null)
    try {
      const started = await api<Job>('/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics,
          singer: singerId,
          duration_seconds: seconds,
          seed,
          composition: {
            code: made.code,
            bpm: made.meta.bpm,
            root: made.meta.root,
            mode: made.meta.mode,
            progression: made.meta.progression,
            title: made.title,
          },
        }),
      })
      jobIdRef.current = started.id
      setJob(started)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '提交失败')
    }
  }

  const cancel = async () => {
    if (!job) return
    try {
      setJob(await api<Job>(`/jobs/${job.id}/cancel`, { method: 'POST' }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '取消失败')
    }
  }

  const volumeQuery = `vocal=${(vocalVol / 100).toFixed(2)}&accomp=${(accompVol / 100).toFixed(2)}`

  const applyVolumes = async () => {
    if (!job || job.state !== 'done') return
    setRemixing(true)
    setError(null)
    try {
      const response = await fetch(`${API}/jobs/${job.id}/download.wav?${volumeQuery}`)
      if (!response.ok) throw new Error('重新混音失败')
      const url = URL.createObjectURL(await response.blob())
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = url
      setAudioUrl(url)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '重新混音失败')
    } finally {
      setRemixing(false)
    }
  }

  const singer = singers.find((item) => item.id === singerId)
  const label = job?.ai_label ?? singer?.ai_label ?? ''

  if (backend !== 'ready') {
    return (
      <section className="mk-card mk-result mk-song" aria-label="歌曲生成">
        <h2 className="mk-title">🎤 歌曲模式</h2>
        {backend === 'checking' ? (
          <p className="mk-hint">正在连接本地歌曲后端…</p>
        ) : (
          <div className="mk-note warn" role="status">
            <p>没有连接到本地歌曲后端。歌曲模式只在本机运行：虚拟歌手模型和 Python 后端都在你的电脑上。</p>
            <p>
              请双击 <code>work\purple-audit\backend\run-backend.bat</code> 启动后端（窗口保持打开），
              并通过本地预览（http://127.0.0.1:3000/）访问本页。
            </p>
            <button type="button" className="mk-btn" onClick={() => void checkBackend()}>
              重新检测
            </button>
          </div>
        )}
        <p className="mk-hint">
          纯音乐模式不受影响，可随时切回。
        </p>
      </section>
    )
  }

  return (
    <section className="mk-card mk-result mk-song" aria-label="歌曲生成">
      <h2 className="mk-title">🎤 歌曲模式（试验）</h2>
      <p className="mk-summary">
        用右边的曲风/情绪/速度/乐器编伴奏，由本机虚拟歌手演唱你的歌词。全程离线、CPU 合成，不上传任何内容。
      </p>

      <label className="mk-song-label" htmlFor="mk-lyrics">歌词（中文，每行一句）</label>
      <textarea
        id="mk-lyrics"
        className="mk-text"
        rows={4}
        maxLength={400}
        disabled={busy}
        value={lyrics}
        onChange={(event) => setLyrics(event.target.value)}
        placeholder={'例如：\n晚风吹过熟悉的街道，\n月光照着回家的方向'}
      />
      {previewError ? <p className="mk-error" role="alert">{previewError}</p> : null}
      {preview && preview.problems.length === 0 ? (
        <p className="mk-hint">
          {preview.lines.length} 句，共 {preview.lines.reduce((n, l) => n + l.syllables.length, 0)} 字；
          每句约 {preview.bars_per_line ?? 0} 小节。成品约 {preview.actual_seconds} 秒
          {preview.extended ? `（歌词较长，已从 ${preview.requested_seconds} 秒自动延长）` : ''}。
          {preview.warnings.map((w) => ` ${w}。`).join('')}
        </p>
      ) : null}
      {preview?.problems.map((p) => <p key={p} className="mk-error" role="alert">{p}</p>)}

      <div className="mk-song-row">
        <fieldset className="mk-field">
          <legend>虚拟歌手</legend>
          <select
            className="mk-select"
            value={singerId}
            disabled={busy}
            onChange={(event) => setSingerId(event.target.value)}
            aria-label="虚拟歌手"
          >
            {singers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>
                {item.name}（{item.language} · {item.engine}）
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="mk-field">
          <legend>歌曲长度</legend>
          <div className="mk-chips">
            {SONG_SECONDS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={seconds === item}
                className={`mk-chip ${seconds === item ? 'on' : ''}`}
                disabled={busy}
                onClick={() => setSeconds(item)}
              >
                {item} 秒
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mk-actions">
        <button type="button" className="mk-create" disabled={busy} onClick={() => void generate()}>
          {busy ? '正在生成…' : '🎤 生成歌曲'}
        </button>
        {busy ? (
          <button type="button" className="mk-btn" onClick={() => void cancel()}>
            取消
          </button>
        ) : null}
      </div>
      <p className="mk-hint">
        在这台电脑上生成需要约 1–3 分钟（CPU 合成，同一时间只处理 1 首）。生成期间请先别做其他吃内存的事。
      </p>
      {error ? <p className="mk-error" role="alert">{error}</p> : null}

      {job && (busy || job.state === 'failed' || job.state === 'cancelled') ? (
        <div className="mk-progress" role="status" aria-live="polite">
          <progress max={100} value={job.percent} />
          <span>
            {job.state === 'failed'
              ? `生成失败：${job.error ?? '未知错误'}`
              : job.state === 'cancelled'
                ? '已取消'
                : `${STAGE_LABEL[job.stage] ?? job.stage}：${job.message}（${Math.round(job.percent)}%，已用 ${Math.round(job.elapsed_seconds)} 秒）`}
          </span>
        </div>
      ) : null}
      {job?.warnings.map((w) => <p key={w} className="mk-note warn">{w}</p>)}

      {job?.state === 'done' && audioUrl ? (
        <div className="mk-song-result">
          <h3 className="mk-song-h">完整歌曲</h3>
          <audio className="mk-audio" controls src={audioUrl} preload="auto" />
          <div className="mk-song-vol">
            <label htmlFor="mk-vocal-vol">人声 <output>{vocalVol}%</output></label>
            <input id="mk-vocal-vol" type="range" min={0} max={150} value={vocalVol} onChange={(e) => setVocalVol(Number(e.target.value))} />
            <label htmlFor="mk-accomp-vol">伴奏 <output>{accompVol}%</output></label>
            <input id="mk-accomp-vol" type="range" min={0} max={150} value={accompVol} onChange={(e) => setAccompVol(Number(e.target.value))} />
            <button type="button" className="mk-btn" disabled={remixing} onClick={() => void applyVolumes()}>
              {remixing ? '混音中…' : '按此音量重新混音试听'}
            </button>
          </div>
          <div className="mk-actions">
            <a className="mk-btn" href={`${API}/jobs/${job.id}/download.wav?${volumeQuery}`} download>
              ⬇ 下载 WAV（按当前音量）
            </a>
            <a className="mk-btn" href={`${API}/jobs/${job.id}/audio/vocal.wav`} download>仅人声</a>
            <a className="mk-btn" href={`${API}/jobs/${job.id}/audio/accomp.wav`} download>仅伴奏</a>
          </div>
          {job.song ? (
            <p className="mk-hint">
              {job.song.key} · {job.song.bpm} BPM · {job.song.bars} 小节 · {job.song.duration_seconds.toFixed(1)} 秒
              。人声与伴奏共用同一 BPM、调性、和弦与小节时间轴。
            </p>
          ) : null}
          <details className="mk-song-stats">
            <summary>本次生成的实际耗时与资源占用</summary>
            <ul>
              <li>总耗时 {Math.round(job.timings.total ?? 0)} 秒（伴奏 {Math.round(job.timings.accomp ?? 0)} 秒，载入模型 {Math.round(job.timings.model_load ?? 0)} 秒，人声 {Math.round(job.timings.vocal ?? 0)} 秒，混音 {Math.round(job.timings.mix ?? 0)} 秒）</li>
              <li>CPU 平均 {job.metrics.cpu_avg_percent_of_machine ?? '–'}%（峰值 {job.metrics.cpu_peak_percent_of_machine ?? '–'}%，{job.metrics.logical_cores ?? '–'} 个逻辑核心）</li>
              <li>后端进程内存峰值 {job.metrics.python_working_set_peak_mb ?? '–'} MB；系统可用内存最低 {job.metrics.system_available_min_mb ?? '–'} MB</li>
            </ul>
          </details>
        </div>
      ) : null}

      <p className="mk-note" role="note">{label}</p>
    </section>
  )
}
