import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react'

/**
 * A ~50-line hash router. Deliberately not react-router: GitHub Pages has no
 * SPA fallback, so path-based routing would need a 404.html redirect hack, and
 * in a standalone PWA the URL is never visible anyway.
 */

function readHash(): string {
  const h = window.location.hash.slice(1)
  return h.startsWith('/') ? h : '/'
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, readHash, () => '/')
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}#${to}`)
  } else {
    window.location.hash = to
  }
}

export function back(): void {
  window.history.back()
}

/**
 * Matches '/session/:id' against '/session/abc', returning { id: 'abc' },
 * or null when the pattern does not apply.
 */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pat = pattern.split('/').filter(Boolean)
  const seg = path.split('/').filter(Boolean)
  if (pat.length !== seg.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i]!
    const s = seg[i]!
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s)
    else if (p !== s) return null
  }
  return params
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  )
}
