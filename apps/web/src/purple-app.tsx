import { isShareId, type SharedPattern } from '@purple/core/shared-pattern'
import { usePlayback } from '@purple/ui/use-playback'
import {
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { InternalLink, type NavigateInApp } from '#/components/internal-link'
import { WEB_AUDIO_OPTIONS, type WebPlayback } from '#/lib/playback'
import { fetchSharedPattern } from '#/lib/public-patterns'

const PurpleStudio = lazy(async () => {
  const studio = await import('#/components/purple-studio')
  return { default: studio.PurpleStudio }
})
const CreateMode = lazy(async () => {
  const create = await import('#/components/create-mode')
  return { default: create.CreateMode }
})
const PatternsPage = lazy(async () => {
  const patterns = await import('#/components/patterns-page')
  return { default: patterns.PatternsPage }
})
const AgentAuthorize = lazy(async () => {
  const authorize = await import('#/components/agent-authorize')
  return { default: authorize.AgentAuthorize }
})

function StudioRoute(props: {
  id: string | null
  navigate: NavigateInApp
  playback: WebPlayback
}) {
  const { id } = props
  const [pattern, setPattern] = useState<SharedPattern | null>(null)
  const [error, setError] = useState<string | null>(
    id && !isShareId(id) ? '这个分享链接无效。' : null,
  )

  useEffect(() => {
    if (!id || !isShareId(id)) return
    const controller = new AbortController()
    void fetchSharedPattern(id, controller.signal)
      .then(setPattern)
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return
        setError('找不到这个分享的作品。')
      })
    return () => controller.abort()
  }, [id])

  if (error) {
    return (
      <RouteMessage message={error}>
        <InternalLink href="/patterns" navigate={props.navigate}>
          浏览公开作品
        </InternalLink>
      </RouteMessage>
    )
  }
  if (id && !pattern) {
    return <BootShell label="正在加载作品…" />
  }
  return (
    <Suspense fallback={<BootShell label="正在加载工作室…" />}>
      <PurpleStudio
        focusOnMount
        navigate={props.navigate}
        playback={props.playback}
        sharedPattern={pattern ?? undefined}
      />
    </Suspense>
  )
}

function BootShell(props: { label: string }) {
  return (
    <main autoFocus className="boot-shell" tabIndex={-1}>
      {props.label}
    </main>
  )
}

function RouteMessage(props: { children?: ReactNode; message: string }) {
  return (
    <main autoFocus className="route-message" tabIndex={-1}>
      <h1>PURPLE</h1>
      <p role="alert">{props.message}</p>
      {props.children}
    </main>
  )
}

interface BrowserRoute {
  href: string
  pathname: string
  search: string
}

function currentBrowserRoute(): BrowserRoute {
  return {
    href: `${window.location.pathname}${window.location.search}`,
    pathname: window.location.pathname,
    search: window.location.search,
  }
}

function AppRoute(props: {
  navigate: NavigateInApp
  playback: WebPlayback
  route: BrowserRoute
}) {
  if (props.route.pathname === '/' && !new URLSearchParams(props.route.search).has('s')) {
    return (
      <Suspense fallback={<BootShell label="正在加载创作页面…" />}>
        <CreateMode navigate={props.navigate} playback={props.playback} />
      </Suspense>
    )
  }
  if (props.route.pathname === '/' || props.route.pathname === '/studio') {
    const id = new URLSearchParams(props.route.search).get('s')
    return (
      <StudioRoute
        id={id}
        key={props.route.href}
        navigate={props.navigate}
        playback={props.playback}
      />
    )
  }
  if (props.route.pathname === '/authorize') {
    return (
      <Suspense fallback={<BootShell label="正在加载…" />}>
        <AgentAuthorize search={props.route.search} />
      </Suspense>
    )
  }
  if (props.route.pathname === '/patterns') {
    return (
      <Suspense fallback={<BootShell label="正在加载作品…" />}>
        <PatternsPage
          focusOnMount
          navigate={props.navigate}
          playback={props.playback}
        />
      </Suspense>
    )
  }
  return (
    <RouteMessage message="此页面不存在。">
      <InternalLink href="/" navigate={props.navigate}>
        返回工作室
      </InternalLink>
    </RouteMessage>
  )
}

export function PurpleApp() {
  const playback = usePlayback(WEB_AUDIO_OPTIONS)
  const [route, setRoute] = useState(currentBrowserRoute)
  const navigate = useCallback<NavigateInApp>((href) => {
    const destination = new URL(href, window.location.origin)
    if (destination.origin !== window.location.origin) {
      window.location.assign(destination)
      return
    }
    const nextHref = `${destination.pathname}${destination.search}`
    if (nextHref !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, '', nextHref)
    }
    setRoute(currentBrowserRoute())
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const updateRoute = () => setRoute(currentBrowserRoute())
    window.addEventListener('popstate', updateRoute)
    return () => window.removeEventListener('popstate', updateRoute)
  }, [])

  const routeLabel = browserRouteLabel(route)
  useEffect(() => {
    document.title = browserRouteTitle(route)
  }, [route])

  return (
    <>
      <span className="sr-only" role="status">{routeLabel}</span>
      <AppRoute navigate={navigate} playback={playback} route={route} />
    </>
  )
}

function browserRouteLabel(route: BrowserRoute): string {
  if (route.pathname === '/studio') return 'Purple 高级模式'
  if (route.pathname === '/') {
    return new URLSearchParams(route.search).has('s')
      ? 'Purple 工作室中的分享作品'
      : 'Purple 创作模式'
  }
  if (route.pathname === '/patterns') return 'Public patterns'
  if (route.pathname === '/authorize') return 'Approve an agent'
  return 'Page not found'
}

function browserRouteTitle(route: BrowserRoute): string {
  if (route.pathname === '/studio') return 'Purple 高级模式'
  if (route.pathname === '/') {
    return new URLSearchParams(route.search).has('s')
      ? 'Shared Strudel Pattern | Purple'
      : 'Purple 音乐工坊：用文字创作纯音乐'
  }
  if (route.pathname === '/patterns') return 'Public Strudel Patterns | Purple'
  if (route.pathname === '/authorize') return 'Approve an Agent | Purple'
  return 'Page Not Found | Purple'
}
