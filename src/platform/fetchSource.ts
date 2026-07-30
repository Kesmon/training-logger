/**
 * Fetching a routine the coach publishes. The only place in the app that talks
 * to the network.
 *
 * This app's defining property is that it works with no signal, so everything
 * here is written to fail quietly and quickly: a short timeout, no retries, and
 * errors that a caller can swallow. Being offline is the normal state, not a
 * fault, and must never look like one.
 */

export class SourceError extends Error {}

export interface FetchedSource {
  text: string
  /** Sniffed from the content type and the body — the importer needs to know. */
  format: 'csv' | 'text'
}

/** Injectable so tests never touch the network. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 10_000
/** A routine is a few kilobytes. Anything past this is not the file we wanted. */
const MAX_BYTES = 1_000_000

/**
 * Validates and tidies a pasted URL.
 *
 * https only: the app is served over https, so a http URL would be blocked as
 * mixed content anyway, and failing here gives a comprehensible reason instead
 * of an opaque network error.
 */
export function normaliseSourceUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new SourceError('Paste the link first.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SourceError('That does not look like a link.')
  }

  if (url.protocol !== 'https:') {
    throw new SourceError('The link has to start with https://')
  }

  // The single most likely mistake: copying the address bar out of an open
  // spreadsheet instead of publishing it. That URL serves an HTML application,
  // not the sheet, and no amount of parsing recovers from it.
  if (url.hostname.endsWith('docs.google.com') && /\/edit|\/htmlview/.test(url.pathname + url.hash)) {
    throw new SourceError(
      'That is the edit link. In the sheet: File → Share → Publish to web → Comma-separated values (.csv).',
    )
  }

  return url.toString()
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html\b)/i.test(text.slice(0, 200))
}

/**
 * Whether the body is a spreadsheet export or a Markdown routine. The same
 * question `ImportScreen` answers for a picked file, asked of a response.
 */
function sniffFormat(text: string, contentType: string): 'csv' | 'text' {
  if (contentType.includes('csv')) return 'csv'
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  if (/^\s*(#|[-*+•]\s)/.test(first)) return 'text'
  return /[,;\t]/.test(first) ? 'csv' : 'text'
}

export async function fetchSource(
  url: string,
  opts?: { fetcher?: Fetcher; timeoutMs?: number },
): Promise<FetchedSource> {
  const fetcher = opts?.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new SourceError('This device cannot fetch links.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? TIMEOUT_MS)

  let response: Response
  try {
    response = await fetcher(url, {
      // The published sheet is served with cache headers of its own; without
      // this the browser can hand back the copy it already had and the check
      // silently never sees an edit.
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (err) {
    // An abort is a timeout; anything else is almost always simply offline.
    throw new SourceError(
      err instanceof DOMException && err.name === 'AbortError'
        ? 'The link took too long to answer.'
        : 'Could not reach the link.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new SourceError(
      response.status === 404
        ? 'That link is gone — it may have been unpublished.'
        : `The link answered ${String(response.status)}.`,
    )
  }

  const text = await response.text()

  if (text.length > MAX_BYTES) {
    throw new SourceError('That link returned far too much data to be a routine.')
  }

  if (looksLikeHtml(text)) {
    throw new SourceError(
      'That link returned a web page rather than a file. If it is a Google Sheet, publish it as CSV first.',
    )
  }

  if (!text.trim()) throw new SourceError('That link returned an empty file.')

  return { text, format: sniffFormat(text, response.headers.get('content-type') ?? '') }
}
