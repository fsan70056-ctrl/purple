import { useEffect, useRef, useState } from 'react'
import {
  buildExternalPrompt,
  clampBpm,
  composeSong,
  DURATIONS_SECONDS,
  GENRE_SPECS,
  GENRES,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  MAX_BPM,
  MIN_BPM,
  MOOD_SPECS,
  MOODS,
  readPrompt,
  type ComposeParams,
  type Composition,
  type Genre,
  type Instrument,
  type Mood,
  type PromptReading,
} from '@purple/core/composer'
import { AudioVisualizer } from '@purple/ui/audio-visualizer'
import { PurpleMark } from '@purple/ui/purple-mark'
import { isTransportActive } from '@purple/ui/use-playback'
import { startWavRecording, type WavRecording } from '@purple/ui/wav-recorder'
import {
  flushSessionPattern,
  saveSessionPattern,
  uniquePatternTitle,
  upsertPattern,
  usePatterns,
} from '#/lib/patterns'
import type { WebPlayback } from '#/lib/playback'
import { InternalLink, type NavigateInApp } from './internal-link'
import { ModalDialog } from './modal-dialog'

const GUIDE_KEY = 'purple.create-guide.v1'

const EXAMPLES = [
  '雨夜咖啡馆，平静的 lofi，80 BPM',
  '128 BPM 电子舞曲，跑步时听',
  '神秘悬疑的电影配乐，带鼓点',
  '轻快的流行，开心的感觉',
]

const GUIDE_STEPS = [
  {
    title: '1. 说说你想听什么',
    body: '在文字框里写一句话，比如“雨夜咖啡馆，平静的 lofi”。不想写也可以，直接点下面的例句。',
  },
  {
    title: '2. 选曲风和情绪',
    body: '点选曲风、情绪，拖动速度，勾选想要的乐器，再选一个时长。选项都有默认值，不改也能出歌。',
  },
  {
    title: '3. 点「创作音乐」',
    body: '几秒内就会开始播放。不满意点「重新生成」换一个版本，喜欢就「保存」或「导出 WAV」。',
  },
]

interface Made extends Composition {
  params: ComposeParams
  seed: number
}

function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_KEY, '1')
  } catch {
    // Private windows may refuse storage; the guide just shows again next time.
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % 100_000
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function durationLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`
}

export function CreateMode(props: {
  navigate: NavigateInApp
  playback: WebPlayback
}) {
  const { navigate, playback } = props
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState<Genre>('lofi')
  const [mood, setMood] = useState<Mood>('calm')
  const [bpm, setBpm] = useState<number>(GENRE_SPECS.lofi.bpm)
  const [instruments, setInstruments] = useState<Instrument[]>([
    ...GENRE_SPECS.lofi.instruments,
  ])
  const [duration, setDuration] = useState<number>(60)
  const [bpmTouched, setBpmTouched] = useState(false)
  const [instrumentsTouched, setInstrumentsTouched] = useState(false)
  const [song, setSong] = useState<Made | null>(null)
  const [reading, setReading] = useState<PromptReading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [guideOpen, setGuideOpen] = useState(() => !guideSeen())
  const [guideStep, setGuideStep] = useState(0)
  const [exporting, setExporting] = useState<{ seconds: number; total: number } | null>(null)
  const savedPatterns = usePatterns()

  const playbackRef = useRef(playback)
  playbackRef.current = playback
  const stateRef = useRef(playback.playbackState)
  stateRef.current = playback.playbackState
  const cancelExportRef = useRef(false)
  const takeRef = useRef<WavRecording | null>(null)

  useEffect(
    () => () => {
      cancelExportRef.current = true
      takeRef.current?.cancel()
    },
    [],
  )

  const audible =
    playback.playbackState === 'playing' || playback.playbackState === 'transitioning'
  const busy = playback.playbackState === 'loading'

  const chooseGenre = (next: Genre) => {
    setGenre(next)
    if (!bpmTouched) setBpm(GENRE_SPECS[next].bpm)
    if (!instrumentsTouched) setInstruments([...GENRE_SPECS[next].instruments])
  }

  const toggleInstrument = (name: Instrument) => {
    setInstrumentsTouched(true)
    setInstruments((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : INSTRUMENTS.filter((item) => item === name || current.includes(item)),
    )
  }

  const make = (nextSeed: number, fromText: boolean) => {
    setError(null)
    setCopied(false)
    const read = fromText ? readPrompt(description) : null
    const params: ComposeParams = {
      genre: read?.genre ?? genre,
      mood: read?.mood ?? mood,
      bpm: clampBpm(read?.bpm ?? bpm),
      instruments: read?.instruments ?? instruments,
      durationSeconds: duration,
    }
    if (params.instruments.length === 0) {
      setError('请至少选择一种乐器。')
      return
    }
    setGenre(params.genre)
    setMood(params.mood)
    setBpm(params.bpm)
    setInstruments([...params.instruments])
    if (read?.bpm !== undefined) setBpmTouched(true)
    if (read?.instruments) setInstrumentsTouched(true)
    if (fromText) setReading(description.trim() ? read : null)
    const made = composeSong(params, nextSeed)
    setSong({ ...made, params, seed: nextSeed })
    void playback.play(made.code)
  }

  const togglePlay = () => {
    if (!song) return
    if (isTransportActive(playback.playbackState)) playback.stop()
    else void playback.play(song.code)
  }

  const save = () => {
    if (!song) return
    const now = Date.now()
    const stored = upsertPattern({
      id: crypto.randomUUID(),
      title: uniquePatternTitle(song.title, savedPatterns),
      code: song.code,
      createdAt: now,
      updatedAt: now,
    })
    if (stored) setSavedCode(song.code)
    else setError('此浏览器无法保存作品（存储空间不可用）。')
  }

  const openAdvanced = () => {
    if (song) {
      saveSessionPattern({ code: song.code, customTitle: song.title })
      flushSessionPattern()
    }
    playback.stop()
    navigate('/studio')
  }

  const exportWav = async () => {
    if (!song || exporting) return
    setError(null)
    cancelExportRef.current = false
    const total = song.params.durationSeconds
    setExporting({ seconds: 0, total })
    try {
      playbackRef.current.stop()
      await playbackRef.current.play(song.code)
      for (let waited = 0; stateRef.current !== 'playing' && waited < 6000; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const analyser = playbackRef.current.getOutputAnalyser()
      if (stateRef.current !== 'playing' || !analyser) {
        setError('没有听到声音，无法导出。请先点击「试听」确认能播放，再导出。')
        return
      }
      const take = startWavRecording(analyser, () => undefined)
      takeRef.current = take
      while (take.elapsedSeconds() < total && !cancelExportRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        setExporting({ seconds: Math.min(total, Math.floor(take.elapsedSeconds())), total })
      }
      takeRef.current = null
      if (cancelExportRef.current) {
        take.cancel()
        return
      }
      const blob = take.finish()
      if (!blob) {
        setError('没有录到声音，请重试。')
        return
      }
      downloadBlob(
        blob,
        `purple-${song.params.genre}-${song.params.mood}-${song.params.bpm}bpm.wav`,
      )
    } catch (failure) {
      console.error('[WAV] export failed:', failure)
      setError('导出失败。请换用最新版 Chrome 或 Edge 再试。')
    } finally {
      playbackRef.current.stop()
      setExporting(null)
    }
  }

  const externalPrompt = song
    ? buildExternalPrompt(description, song.params)
    : buildExternalPrompt(description, {
        genre,
        mood,
        bpm,
        instruments,
        durationSeconds: duration,
      })

  const copyExternalPrompt = async () => {
    try {
      await navigator.clipboard.writeText(externalPrompt)
      setCopied(true)
    } catch {
      setCopied(false)
      setError('无法自动复制，请手动选中下方文字复制。')
    }
  }

  const closeGuide = () => {
    markGuideSeen()
    setGuideOpen(false)
    setGuideStep(0)
  }

  const unreadable = reading !== null && !reading.understood
  const saved = song !== null && savedCode === song.code
  const bars = song?.bars ?? 0

  return (
    <main className="mk-shell">
      <header className="mk-top">
        <div className="mk-brand">
          <PurpleMark className="brand-mark" />
          <span>PURPLE 音乐工坊</span>
        </div>
        <nav className="mk-nav" aria-label="页面导航">
          <button type="button" className="mk-ghost" onClick={() => setGuideOpen(true)}>
            新手引导
          </button>
          <InternalLink className="mk-ghost" href="/studio" navigate={navigate}>
            高级模式
          </InternalLink>
        </nav>
      </header>

      <section className="mk-hero">
        <h1>描述一下，我来编一首纯音乐</h1>
        <p>
          选好风格点一下就能听。全部在你的浏览器里完成，免费，不需要账号。
        </p>
      </section>

      <div className="mk-grid">
        <section className="mk-card" aria-label="创作设置">
          <h2 className="mk-step"><b>①</b> 描述你想听的音乐（可不填）</h2>
          <textarea
            id="mk-description"
            className="mk-text"
            aria-label="音乐描述"
            maxLength={200}
            placeholder="例如：雨夜咖啡馆，平静的 lofi，80 BPM"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="mk-chips" aria-label="示例描述">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="mk-chip small"
                onClick={() => setDescription(example)}
              >
                {example}
              </button>
            ))}
          </div>

          <h2 className="mk-step"><b>②</b> 选择风格</h2>
          <fieldset className="mk-field">
            <legend>曲风</legend>
            <div className="mk-chips">
              {GENRES.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={genre === item}
                  className={`mk-chip ${genre === item ? 'on' : ''}`}
                  title={GENRE_SPECS[item].blurb}
                  onClick={() => chooseGenre(item)}
                >
                  {GENRE_SPECS[item].label}
                </button>
              ))}
            </div>
            <p className="mk-hint">{GENRE_SPECS[genre].blurb}</p>
          </fieldset>
          <fieldset className="mk-field">
            <legend>情绪</legend>
            <div className="mk-chips">
              {MOODS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={mood === item}
                  className={`mk-chip ${mood === item ? 'on' : ''}`}
                  onClick={() => setMood(item)}
                >
                  {MOOD_SPECS[item].label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mk-field">
            <label htmlFor="mk-bpm">
              速度 <output>{bpm} BPM</output>
            </label>
            <input
              id="mk-bpm"
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              value={bpm}
              onChange={(event) => {
                setBpmTouched(true)
                setBpm(Number(event.target.value))
              }}
            />
            <p className="mk-hint">数字越大越快；不确定就不用动。</p>
          </div>
          <fieldset className="mk-field">
            <legend>乐器（可多选，均为合成器音色）</legend>
            <div className="mk-chips">
              {INSTRUMENTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={instruments.includes(item)}
                  className={`mk-chip ${instruments.includes(item) ? 'on' : ''}`}
                  onClick={() => toggleInstrument(item)}
                >
                  {INSTRUMENT_LABELS[item]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mk-field">
            <legend>音乐时长（导出 WAV 的长度）</legend>
            <div className="mk-chips">
              {DURATIONS_SECONDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={duration === item}
                  className={`mk-chip ${duration === item ? 'on' : ''}`}
                  onClick={() => setDuration(item)}
                >
                  {durationLabel(item)}
                </button>
              ))}
            </div>
          </fieldset>

          <h2 className="mk-step"><b>③</b> 开始创作</h2>
          <button
            type="button"
            className={`mk-create ${song ? '' : 'pulse'}`}
            disabled={busy || exporting !== null}
            onClick={() => make(randomSeed(), true)}
          >
            {busy ? '正在准备…' : '✨ 创作音乐'}
          </button>
          <p className="mk-honest">
            这是本地规则编曲：按你的选项和描述里的关键词，用内置合成器音色编排纯音乐。
            不是 AI 生成，没有歌声，也不会写歌词。
          </p>
          {error ? <p className="mk-error" role="alert">{error}</p> : null}
        </section>

        <section className="mk-card mk-result" aria-label="作品" aria-live="polite">
          {!song ? (
            <div className="mk-empty">
              <p className="mk-empty-title">还没有作品</p>
              <p>在左边选好后点「创作音乐」，作品会显示在这里并自动播放。</p>
            </div>
          ) : (
            <>
              <h2 className="mk-title">{song.title}</h2>
              <p className="mk-summary">{song.summary}</p>
              <AudioVisualizer active={audible} getAnalyser={playback.getOutputAnalyser} />
              <div className="mk-actions">
                <button
                  type="button"
                  className={`mk-play ${audible || busy ? 'stop' : ''}`}
                  disabled={exporting !== null}
                  onClick={togglePlay}
                >
                  {audible || busy ? '■ 停止' : '▶ 试听'}
                </button>
                <button
                  type="button"
                  className="mk-btn"
                  disabled={busy || exporting !== null}
                  onClick={() => make(randomSeed(), false)}
                >
                  🔄 重新生成
                </button>
                <button
                  type="button"
                  className="mk-btn"
                  disabled={saved || exporting !== null}
                  onClick={save}
                >
                  {saved ? '✓ 已保存' : '💾 保存'}
                </button>
                {exporting ? (
                  <button
                    type="button"
                    className="mk-btn"
                    onClick={() => {
                      cancelExportRef.current = true
                    }}
                  >
                    取消导出
                  </button>
                ) : (
                  <button type="button" className="mk-btn" onClick={() => void exportWav()}>
                    ⬇ 导出 WAV
                  </button>
                )}
              </div>
              {exporting ? (
                <div className="mk-progress" role="status">
                  <progress max={exporting.total} value={exporting.seconds} />
                  <span>
                    正在录制 {exporting.seconds}/{exporting.total} 秒，请保持本页面打开。
                  </span>
                </div>
              ) : (
                <p className="mk-hint">
                  约 {bars} 小节循环。导出 WAV 会实时录制 {durationLabel(song.params.durationSeconds)}。
                  {saved ? '已保存，可在「高级模式」的作品库中找到。' : ''}
                </p>
              )}
              <button type="button" className="mk-link" onClick={openAdvanced}>
                在高级模式中打开代码 →
              </button>
            </>
          )}

          {reading && reading.matched.length > 0 ? (
            <div className="mk-note" role="status">
              <strong>从描述里识别到：</strong>
              <ul>
                {reading.matched.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ) : null}
          {reading?.unsupported.length ? (
            <p className="mk-note warn" role="status">
              当前只能做纯音乐编曲，不能生成{reading.unsupported.join('、')}。这部分要求已忽略。
            </p>
          ) : null}
          {reading?.notes.map((line) => (
            <p key={line} className="mk-note" role="status">{line}</p>
          ))}
          {unreadable ? (
            <div className="mk-note warn" role="status">
              <p>
                没能从描述里识别出曲风、情绪、速度或乐器，已按你选的选项编曲。
                这里只做关键词匹配，不能真正“理解”一句话。
              </p>
              <p>想让外部 AI 按你的描述写编曲代码？复制这段指令给它：</p>
              <textarea className="mk-text" readOnly rows={5} value={externalPrompt} />
              <button type="button" className="mk-btn" onClick={() => void copyExternalPrompt()}>
                {copied ? '✓ 已复制' : '复制指令'}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="mk-foot">
        基于开源项目 Purple（MIT）与 Strudel（AGPL-3.0-or-later）。本地预览版仅供个人研究使用。
      </footer>

      {guideOpen ? (
        <ModalDialog
          className="feedback-dialog mk-guide"
          titleId="mk-guide-title"
          descriptionId="mk-guide-body"
          title={GUIDE_STEPS[guideStep].title}
          closeLabel="关闭引导"
          onClose={closeGuide}
        >
          {() => (
            <div className="mk-guide-body">
              <p id="mk-guide-body">{GUIDE_STEPS[guideStep].body}</p>
              <p className="mk-guide-dots" aria-hidden="true">
                {GUIDE_STEPS.map((_, index) => (
                  <i key={index} className={index === guideStep ? 'on' : ''} />
                ))}
              </p>
              <div className="mk-guide-actions">
                {guideStep > 0 ? (
                  <button type="button" className="mk-btn" onClick={() => setGuideStep(guideStep - 1)}>
                    上一步
                  </button>
                ) : (
                  <button type="button" className="mk-btn" onClick={closeGuide}>
                    跳过
                  </button>
                )}
                {guideStep < GUIDE_STEPS.length - 1 ? (
                  <button type="button" className="mk-create small" onClick={() => setGuideStep(guideStep + 1)}>
                    下一步
                  </button>
                ) : (
                  <button type="button" className="mk-create small" onClick={closeGuide}>
                    开始创作
                  </button>
                )}
              </div>
            </div>
          )}
        </ModalDialog>
      ) : null}
    </main>
  )
}
