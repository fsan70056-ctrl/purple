import {
  MAX_PATTERN_LENGTH,
  patternFilename,
  validatePatternTitle,
  validatePatternCode,
} from '@purple/core/pattern'
import { describeValidationProblem } from '@purple/core/validation'
import { LOCAL_STARTER_PATTERNS } from '@purple/core/local-starter-patterns'
import type { ShowcasePattern } from '@purple/core/showcase-patterns'
import type { SharedPattern } from '@purple/core/shared-pattern'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { InternalLink, type NavigateInApp } from './internal-link'
import {
  loadSessionPattern,
  flushSessionPattern,
  removePattern,
  saveSessionPattern,
  sharedLibraryId,
  uniquePatternTitle,
  upsertPattern,
  usePatterns,
} from '#/lib/patterns'
import { syncSharedPatternUrl } from '#/lib/public-patterns'
import { answerStudioPings } from '#/lib/studio-presence'
import {
  agentLinkSocketUrl,
  loadAgentLinkSettings,
  type AgentLinkSettings,
} from '#/lib/agent-link-storage'
import { PurpleMark } from '@purple/ui/purple-mark'
import { useAgentLink, type AgentLinkHandlers } from '@purple/ui/use-agent-link'
import { useWebMcpTools } from '@purple/ui/use-web-mcp'
import { AudioVisualizer } from '@purple/ui/audio-visualizer'
import { startWavRecording, type WavRecording } from '@purple/ui/wav-recorder'
import { hasUnappliedEditorChanges, isTransportActive } from '@purple/ui/use-playback'
import type { PatternEditorProps } from '@purple/ui/pattern-editor'
import type { WebPlayback } from '#/lib/playback'

const PatternEditor = lazy(async () => {
  const editor = await import('@purple/ui/pattern-editor')
  return { default: editor.PatternEditor }
})
const AgentCard = lazy(async () => {
  const card = await import('./agent-card')
  return { default: card.AgentCard }
})
const FeedbackDialog = lazy(async () => {
  const feedback = await import('./feedback-dialog')
  return { default: feedback.FeedbackDialog }
})
const ShareDialog = lazy(async () => {
  const share = await import('./share-dialog')
  return { default: share.ShareDialog }
})

const LIBRARY_WRITE_ERROR =
  '浏览器无法更新作品库。请允许本站使用网站数据后重试。'

function DeferredPatternEditor(props: PatternEditorProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Let the shell and transport paint before requesting CodeMirror. Playback
    // does not depend on the editor chunk and remains usable in the meantime.
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const fallback = (
    <pre aria-label="编辑器加载中" className="editor-loading">
      {props.code}
    </pre>
  )
  if (!ready) return fallback
  return (
    <Suspense fallback={fallback}>
      <PatternEditor {...props} />
    </Suspense>
  )
}

export interface PurpleStudioProps {
  focusOnMount?: boolean
  navigate?: NavigateInApp
  /** Owned by the route so audio survives navigation between pages. */
  playback: WebPlayback
  sharedPattern?: SharedPattern
}

export function PurpleStudio({
  focusOnMount,
  navigate,
  playback,
  sharedPattern,
}: PurpleStudioProps) {
  const [agentLink] = useState<AgentLinkSettings>(loadAgentLinkSettings)
  // The pairing panel is the whole session pane. It steps aside once an agent
  // is actually driving the tab, and the topbar badge brings it back.
  const isPhoneWidth = usePhoneWidth()
  const [agentPanelOpen, setAgentPanelOpen] = useState(() => !isPhoneWidth)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [libraryWasCleared, setLibraryWasCleared] = useState(false)
  const [patternStorageError, setPatternStorageError] = useState<string | null>(null)
  const [initialPattern] = useState(() => loadInitialPattern(sharedPattern))
  const [code, setCode] = useState(initialPattern.code)
  const [customTitle, setCustomTitle] = useState(initialPattern.customTitle)
  const [shareId, setShareId] = useState<string | null>(initialPattern.shareId)
  const [originShareId, setOriginShareId] = useState<string | null>(
    initialPattern.originShareId,
  )
  const savedPatterns = usePatterns()
  const mainRef = useRef<HTMLElement | null>(null)
  const [recording, setRecording] = useState<WavRecording | null>(null)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recordingRef = useRef<WavRecording | null>(null)
  const stopRecordingRef = useRef<() => void>(() => {})
  const libraryRef = useRef<HTMLElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const editorHasUnappliedChanges = hasUnappliedEditorChanges(
    playback.playbackState,
    code,
    playback.activeCode,
  )
  const commitCode = useCallback((nextCode: string) => {
    setCode(nextCode)
    setShareId(null)
  }, [])
  const commitCustomTitle = useCallback((nextTitle: string | null) => {
    setCustomTitle(nextTitle)
    setShareId(null)
  }, [])

  useEffect(() => {
    saveSessionPattern({
      code,
      customTitle,
      shareId: shareId ?? undefined,
      originShareId: originShareId ?? undefined,
    })
  }, [code, customTitle, shareId, originShareId])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.hidden) flushSessionPattern()
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushSessionPattern)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushSessionPattern)
      flushSessionPattern()
    }
  }, [])

  const title = customTitle ?? '未命名作品'
  const patternName = title.trim() || '未命名作品'
  const patternIsSavable = validatePatternCode(code) !== null

  // The agent can send set_pattern and play back to back, faster than React
  // re-renders the handler closures; refs keep the served code current.
  const codeRef = useRef(code)
  codeRef.current = code
  const patternNameRef = useRef(patternName)
  patternNameRef.current = patternName
  // One set of handlers serves the relay link and the page's WebMCP tools.
  const agentHandlers: AgentLinkHandlers = {
    getSession: () => ({
      code: codeRef.current,
      title: patternNameRef.current,
      playbackState: playback.playbackState,
      playbackError: playback.error,
    }),
    setPattern: async (rawCode, rawTitle) => {
      const nextCode = validatePatternCode(rawCode)
      if (!nextCode) {
        throw new Error(
          `The pattern must be non-empty and at most ${MAX_PATTERN_LENGTH} characters.`,
        )
      }
      // Null means the engine has not initialized yet (no click so far);
      // the pattern lands unaudited and play-time errors stay the net.
      const problems = await playback.validatePattern(nextCode)
      if (problems !== null && problems.length > 0) {
        return {
          committed: false,
          problems: problems.map(describeValidationProblem),
        }
      }
      codeRef.current = nextCode
      commitCode(nextCode)
      if (rawTitle !== null) {
        const nextTitle = validatePatternTitle(rawTitle)
        if (nextTitle) commitCustomTitle(nextTitle)
      }
      return { committed: true }
    },
    play: async () => {
      const result = await playback.transition(codeRef.current)
      if (result.ok) return { ok: true }
      if (result.kind === 'cancelled') {
        return { ok: false, error: '播放被其他操作打断。' }
      }
      return { ok: false, error: result.error }
    },
    stop: () => playback.stop(),
  }
  const agentLinked = useAgentLink({
    url: agentLinkSocketUrl(agentLink),
    handlers: agentHandlers,
  })
  useWebMcpTools(agentHandlers)
  // Lets an Allow page in this browser see that a studio tab is already open.
  useEffect(() => answerStudioPings(), [])

  useEffect(() => {
    // Setup is done the moment an agent answers, so hand the room back to the
    // editor. Reopening stays a deliberate click on the topbar badge.
    if (agentLinked) setAgentPanelOpen(false)
  }, [agentLinked])

  const libraryPattern = savedPatterns.find(
    (pattern) =>
      (shareId !== null && pattern.shareId === shareId) ||
      (pattern.title === patternName && pattern.code === code),
  )
  const currentPatternSaved = libraryPattern !== undefined

  const toggleSavedPattern = () => {
    if (!patternIsSavable) return
    const targetShareId = shareId
    let persisted = true
    if (libraryPattern) {
      persisted = removePattern(libraryPattern.id)
    } else {
      const now = Date.now()
      const savedTitle = uniquePatternTitle(patternName, savedPatterns)
      persisted = upsertPattern({
        id: targetShareId ? sharedLibraryId(targetShareId) : crypto.randomUUID(),
        title: savedTitle,
        code,
        shareId: targetShareId ?? undefined,
        createdAt: now,
        updatedAt: now,
      })
      if (!targetShareId && savedTitle !== patternName) {
        commitCustomTitle(savedTitle)
      }
    }
    if (!persisted) {
      setPatternStorageError(LIBRARY_WRITE_ERROR)
      return
    }
    setPatternStorageError(null)
    setLibraryWasCleared(false)
  }

  const applyShareIdentity = (id: string | null) => {
    setShareId(id)
    setOriginShareId(id)
    syncSharedPatternUrl(id)
  }

  const acceptSharedPattern = (id: string, sharedTitle: string) => {
    const libraryUpdated = !libraryPattern || upsertPattern({
      ...libraryPattern,
      title: sharedTitle,
      shareId: id,
    })
    commitCustomTitle(sharedTitle)
    applyShareIdentity(id)
    if (!libraryUpdated) {
      setPatternStorageError(
        '作品已发布，但此浏览器无法更新作品库中的副本。',
      )
      return
    }
    setPatternStorageError(null)
  }

  const loadLibraryPattern = (pattern: {
    title: string
    code: string
    shareId?: string
  }) => {
    commitCode(pattern.code)
    commitCustomTitle(pattern.title)
    applyShareIdentity(pattern.shareId ?? null)
    setPatternStorageError(null)
    setLibraryOpen(false)
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking synchronously aborts the still-pending download outside Chromium.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const exportPattern = () => {
    downloadBlob(
      new Blob([`${code.trim()}\n`], { type: 'text/plain' }),
      patternFilename(title),
    )
  }

  const stopRecording = () => {
    const active = recordingRef.current
    if (!active) return
    recordingRef.current = null
    setRecording(null)
    const blob = active.finish()
    if (!blob) {
      setRecordError('没有录到声音。请先点击「播放」，再开始录制。')
      return
    }
    downloadBlob(blob, `${patternFilename(title).replace(/\.[^.]+$/, '')}.wav`)
  }
  stopRecordingRef.current = stopRecording

  const startRecording = () => {
    setRecordError(null)
    const analyser = playback.getOutputAnalyser()
    if (!analyser || !audible) {
      setRecordError('请先点击「播放」，听到声音后再开始录制 WAV。')
      return
    }
    try {
      const take = startWavRecording(analyser, () => stopRecordingRef.current())
      recordingRef.current = take
      setRecordSeconds(0)
      setRecording(take)
    } catch (error) {
      console.error('[WAV] Recording could not start:', error)
      setRecordError('此浏览器无法开始录制。请换用最新版 Chrome 或 Edge。')
    }
  }

  const playCurrentPattern = () => {
    void playback.play(code)
  }

  const togglePlayback = () => {
    if (isTransportActive(playback.playbackState)) playback.stop()
    else playCurrentPattern()
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '.') {
        event.preventDefault()
        playback.stop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playback.stop])

  useEffect(() => {
    if (!libraryOpen) return
    // pointerdown, not click: the popover should close before whatever is
    // underneath reacts. The LIBRARY button is excluded so its own click
    // stays a toggle instead of close-then-reopen.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (libraryRef.current?.contains(target)) return
      if (libraryButtonRef.current?.contains(target)) return
      setLibraryOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setLibraryOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [libraryOpen])

  const audible =
    playback.playbackState === 'playing' || playback.playbackState === 'transitioning'

  useEffect(() => {
    if (focusOnMount) mainRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(
      () => setRecordSeconds(Math.floor(recording.elapsedSeconds())),
      500,
    )
    return () => clearInterval(timer)
  }, [recording])

  // Leaving the page discards an unfinished take instead of leaking the tap.
  useEffect(() => () => recordingRef.current?.cancel(), [])

  return (
    <main
      className="studio-shell"
      ref={mainRef}
      tabIndex={focusOnMount ? -1 : undefined}
    >
      <header className="topbar">
        <div className="brand">
          <PurpleMark className="brand-mark" />
          <span className="brand-name">PURPLE</span>
        </div>
        <div className="topbar-actions">
          <InternalLink className="chrome" href="/" navigate={navigate}>
            ← 创作模式
          </InternalLink>
          <InternalLink
            className="chrome patterns-link"
            href="/patterns"
            navigate={navigate}
          >
            公开作品
          </InternalLink>
          <a
            className="chrome source-link"
            href="https://github.com/ferdousbhai/purple"
            rel="noreferrer"
            target="_blank"
          >
            源码
          </a>
          <a
            className="chrome source-link"
            href="https://opencollective.com/tidalcycles"
            rel="noreferrer"
            target="_blank"
            title="Purple 基于 Strudel 运行，欢迎在 Open Collective 支持其开发者。"
          >
            ♥ STRUDEL
          </a>
          <button
            className="chrome feedback-trigger"
            aria-haspopup="dialog"
            onClick={() => {
              setLibraryOpen(false)
              setFeedbackOpen(true)
            }}
          >
            反馈
          </button>
          <button
            ref={libraryButtonRef}
            className={`chrome ${libraryOpen ? 'open' : ''}`}
            aria-expanded={libraryOpen}
            aria-haspopup="true"
            onClick={() => setLibraryOpen((open) => !open)}
          >
            作品库
          </button>
          <button
            className={`chrome agent-badge ${agentPanelOpen ? 'open' : ''}`}
            aria-expanded={agentPanelOpen}
            title={
              agentLinked
                ? '你的 AI 助手正在控制此页面，点击查看连接方式。'
                : '尚未连接 AI 助手，点击查看连接方式。'
            }
            onClick={() => setAgentPanelOpen((open) => !open)}
          >
            AI 助手
            <span
              className={`agent-dot ${agentLinked ? 'linked' : ''}`}
              aria-hidden="true"
            />
            <span className="sr-only">{agentLinked ? ' 已连接' : ' 等待中'}</span>
          </button>
        </div>
      </header>

      {feedbackOpen ? (
        <Suspense fallback={null}>
          <FeedbackDialog
            onClose={() => setFeedbackOpen(false)}
            playbackError={playback.error}
          />
        </Suspense>
      ) : null}

      {shareOpen ? (
        <Suspense fallback={null}>
          <ShareDialog
            code={code}
            existingId={shareId}
            navigate={navigate}
            republish={shareId === null && originShareId !== null}
            title={patternName}
            onClose={() => setShareOpen(false)}
            onShared={acceptSharedPattern}
          />
        </Suspense>
      ) : null}

      {libraryOpen ? (
        <section className="library-popover" ref={libraryRef} aria-label="作品库">
          <header className="library-head">
            <span>作品库</span>
            <span className="library-count">
              {`${savedPatterns.length} 个作品`}
            </span>
          </header>
          {savedPatterns.length === 0 ? (
            <p className="muted" role={libraryWasCleared ? 'status' : undefined}>
              {libraryWasCleared
                ? '作品库是空的，没有已保存的作品。'
                : '还没有保存的作品。点击「保存」会把作品存在此浏览器中。'}
            </p>
          ) : (
            [...savedPatterns]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((pattern) => (
                <div key={pattern.id} className="library-row">
                  <button onClick={() => loadLibraryPattern(pattern)}>
                    {pattern.title}
                  </button>
                  <button
                    className="delete"
                    aria-label={`删除 ${pattern.title}`}
                    onClick={() => {
                      if (!window.confirm(`从此浏览器删除“${pattern.title}”？`)) return
                      if (!removePattern(pattern.id)) {
                        setPatternStorageError(LIBRARY_WRITE_ERROR)
                        return
                      }
                      setPatternStorageError(null)
                      if (savedPatterns.length === 1) setLibraryWasCleared(true)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
          )}
        </section>
      ) : null}

      <div className={`studio-grid ${agentPanelOpen ? '' : 'editor-only'}`}>
        <section className="editor-pane">
          <div className="editor-bar">
            <input
              className="title-input"
              aria-label="作品标题"
              name="pattern-title"
              value={title}
              onChange={(event) => commitCustomTitle(event.target.value)}
              maxLength={60}
            />
            <button
              className={`chrome ${currentPatternSaved ? 'saved' : ''}`}
              disabled={!patternIsSavable}
              onClick={toggleSavedPattern}
              title={
                currentPatternSaved
                  ? '从此浏览器作品库中移除'
                  : '保存到此浏览器作品库'
              }
            >
              <span aria-live="polite">{currentPatternSaved ? '已保存' : '保存'}</span>
            </button>
            <button
              className={`chrome ${shareId ? 'saved' : ''}`}
              disabled={!patternIsSavable}
              title={
                shareId
                  ? '此作品已发布，点击查看链接。'
                  : originShareId
                    ? '发布此作品的新公开副本。'
                    : '发布到公开作品库（本地预览版不可用）'
              }
              onClick={() => setShareOpen(true)}
            >
              <span aria-live="polite">{shareId ? '已分享' : '分享'}</span>
            </button>
            <button
              className="chrome export"
              title="把当前作品的 Strudel 代码导出为文本文件"
              onClick={exportPattern}
            >
              导出代码
            </button>
            <button
              className={`chrome export ${recording ? 'recording' : ''}`}
              title="把正在播放的声音录制成 WAV 文件（最长 5 分钟）"
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? `■ 停止并保存 ${formatClock(recordSeconds)}` : '录制 WAV'}
            </button>
            {editorHasUnappliedChanges ? (
              <button
                className="chrome apply-changes"
                aria-label="将编辑器修改应用到播放（Ctrl+Enter）"
                title="应用修改（Ctrl+Enter）"
                onClick={playCurrentPattern}
              >
                应用
              </button>
            ) : null}
            <button
              className={`transport ${audible || playback.playbackState === 'loading' ? 'stop' : 'start'}`}
              onClick={togglePlayback}
            >
              {transportLabel(playback.playbackState)}
            </button>
          </div>

          <div className="editor-surface">
            <DeferredPatternEditor
              code={code}
              playbackHighlightActive={
                playback.playbackState === 'playing' &&
                code === playback.activeCode
              }
              getActiveSourceRanges={playback.getActiveSourceRanges}
              onCodeChange={commitCode}
              // Strudel convention: Mod+Enter always (re-)evaluates, so a live
              // edit mid-playback picks up the new pattern instead of stopping.
              onEvaluate={playCurrentPattern}
            />
          </div>

          <AudioVisualizer active={audible} getAnalyser={playback.getOutputAnalyser} />

          {playback.error ? <p className="error" role="alert">{playback.error}</p> : null}
          {recordError ? <p className="error" role="alert">{recordError}</p> : null}
          {patternStorageError ? (
            <p className="error" role="alert">{patternStorageError}</p>
          ) : null}
        </section>

        {agentPanelOpen ? (
          <Suspense fallback={<aside className="session-pane" aria-busy="true" />}>
            <AgentCard
              code={agentLink.code}
              linked={agentLinked}
              mobile={isPhoneWidth}
              onClose={() => setAgentPanelOpen(false)}
            />
          </Suspense>
        ) : null}
      </div>
    </main>
  )
}

/** Mirrors the stylesheet's phone tier, where the editor wraps long lines. */
function usePhoneWidth(): boolean {
  const [isPhone, setIsPhone] = useState(
    () => window.matchMedia('(max-width: 560px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 560px)')
    const update = () => setIsPhone(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return isPhone
}

function loadInitialPattern(sharedPattern?: SharedPattern) {
  const restored = loadSessionPattern()
  if (sharedPattern) {
    if (
      restored
      && (restored.shareId === sharedPattern.id
        || restored.originShareId === sharedPattern.id)
    ) {
      return fromSession(restored, sharedPattern.id)
    }
    return workingPattern(sharedPattern.code, sharedPattern.title, sharedPattern.id)
  }
  if (restored) return fromSession(restored, null)
  const starter = randomStarter()
  return workingPattern(starter.code, starter.title, null)
}

function fromSession(
  restored: NonNullable<ReturnType<typeof loadSessionPattern>>,
  originFallback: string | null,
) {
  return workingPattern(
    restored.code,
    restored.customTitle,
    restored.shareId ?? null,
    restored.originShareId ?? restored.shareId ?? originFallback,
  )
}

function workingPattern(
  code: string,
  customTitle: string | null,
  shareId: string | null,
  originShareId: string | null = shareId,
) {
  return { code, customTitle, shareId, originShareId }
}

function randomStarter(): ShowcasePattern {
  const random = crypto.getRandomValues(new Uint32Array(1))[0]
  return LOCAL_STARTER_PATTERNS[random % LOCAL_STARTER_PATTERNS.length]
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function transportLabel(state: WebPlayback['playbackState']): string {
  return isTransportActive(state) ? '■ 停止' : '▶ 播放'
}
