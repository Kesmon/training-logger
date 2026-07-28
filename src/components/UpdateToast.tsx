import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * The service worker is registered with `prompt`, not `autoUpdate`: a silent
 * reload in the middle of a set would be worse than a stale build. This makes
 * the waiting worker visible and lets you take the update between sessions.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="toast" role="status">
      <span style={{ flex: 1 }}>New version available</span>
      <button className="btn btn--sm btn--ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button className="btn btn--sm btn--primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  )
}
