import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { Nav } from './components/Nav'
import { UpdateToast } from './components/UpdateToast'
import { useResolvedTheme } from './hooks/useResolvedTheme'
import { useSettings } from './hooks/useSettings'
import { matchRoute, usePath } from './router'
import { ExerciseDetail } from './screens/ExerciseDetail'
import { History } from './screens/History'
import { ImportScreen } from './screens/ImportScreen'
import { Library } from './screens/Library'
import { LibraryCleanup } from './screens/LibraryCleanup'
import { RoutineDetail } from './screens/RoutineDetail'
import { SessionDetail } from './screens/SessionDetail'
import { SessionScreen } from './screens/SessionScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Today } from './screens/Today'
import { checkAllRoutineSources } from './sync/updateRoutine'

// Charts are the only thing pulling in Recharts, and they are never needed
// mid-session. Splitting them keeps the logging path light.
const Progress = lazy(() =>
  import('./screens/Progress').then((m) => ({ default: m.Progress })),
)

interface Route {
  pattern: string
  render: (params: Record<string, string>) => ReactNode
  /** The active-session screen hides the tab bar so nothing is one tap away. */
  hideNav?: boolean
}

const ROUTES: Route[] = [
  { pattern: '/', render: () => <Today /> },
  { pattern: '/session/:id', render: (p) => <SessionScreen id={p.id!} />, hideNav: true },
  { pattern: '/history', render: () => <History /> },
  { pattern: '/history/:id', render: (p) => <SessionDetail id={p.id!} /> },
  { pattern: '/progress', render: () => <Progress /> },
  { pattern: '/progress/:id', render: (p) => <Progress exerciseId={p.id!} /> },
  { pattern: '/library', render: () => <Library /> },
  { pattern: '/library/cleanup', render: () => <LibraryCleanup /> },
  { pattern: '/exercise/:id', render: (p) => <ExerciseDetail id={p.id!} /> },
  { pattern: '/routine/:id', render: (p) => <RoutineDetail id={p.id!} /> },
  { pattern: '/import', render: () => <ImportScreen /> },
  { pattern: '/settings', render: () => <SettingsScreen /> },
]

function resolve(path: string): { node: ReactNode; hideNav: boolean } {
  for (const route of ROUTES) {
    const params = matchRoute(route.pattern, path)
    if (params) return { node: route.render(params), hideNav: route.hideNav ?? false }
  }
  return { node: <Today />, hideNav: false }
}

export function App() {
  const path = usePath()
  const settings = useSettings()
  const resolved = useResolvedTheme()
  const { node, hideNav } = resolve(path)

  // data-theme always carries the *resolved* theme, never 'system'. That keeps
  // the CSS tokens and the chart colours reading from one source of truth —
  // otherwise a system-light phone gets a dark UI with light chart marks.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    // Mirrored so the inline script in index.html can apply it before paint.
    try {
      localStorage.setItem('tl-theme', settings.theme)
    } catch {
      // Private mode can refuse writes; the flash is cosmetic.
    }
  }, [resolved, settings.theme])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [path])

  // Subscribed routines are re-checked when the app is opened or comes back to
  // the foreground. Deliberately after first paint and deliberately unawaited:
  // this app's whole point is working with no signal, so a check must never be
  // something the UI is waiting on. `checkAllRoutineSources` resolves rather
  // than throwing on failure, and rate-limits itself.
  useEffect(() => {
    const check = () => {
      void checkAllRoutineSources().catch(() => {})
    }
    const settle = setTimeout(check, 1500)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(settle)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <div className="app">
      <Suspense fallback={<div className="main" />}>{node}</Suspense>
      {!hideNav && <Nav path={path} />}
      <UpdateToast />
    </div>
  )
}
