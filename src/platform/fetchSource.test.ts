import { describe, expect, it } from 'vitest'
import { fetchSource, normaliseSourceUrl, SourceError, type Fetcher } from './fetchSource'

const PUBLISHED = 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv'

/** A fetcher answering with a fixed body, so nothing here touches a network. */
const serving = (body: string, init?: ResponseInit): Fetcher =>
  async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/csv' }, ...init })

describe('normaliseSourceUrl', () => {
  it('accepts a published sheet link', () => {
    expect(normaliseSourceUrl(`  ${PUBLISHED}  `)).toBe(PUBLISHED)
  })

  it('rejects an empty or unparseable link', () => {
    expect(() => normaliseSourceUrl('   ')).toThrow(SourceError)
    expect(() => normaliseSourceUrl('not a link')).toThrow(SourceError)
  })

  it('rejects http, which the page could not load anyway', () => {
    expect(() => normaliseSourceUrl('http://example.com/a.csv')).toThrow(/https/)
  })

  it('names the mistake when given the edit link instead of the published one', () => {
    // Copying the address bar out of an open sheet is the single likeliest
    // error, and it fails in a way no parser can recover from.
    expect(() =>
      normaliseSourceUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=0'),
    ).toThrow(/Publish to web/)
  })

  it('leaves a non-Google link alone', () => {
    const raw = 'https://raw.githubusercontent.com/someone/repo/main/block.md'
    expect(normaliseSourceUrl(raw)).toBe(raw)
  })
})

describe('fetchSource', () => {
  it('returns the body and calls a comma file CSV', async () => {
    const result = await fetchSource(PUBLISHED, { fetcher: serving('exercise,sets\nSquat,5') })

    expect(result.text).toBe('exercise,sets\nSquat,5')
    expect(result.format).toBe('csv')
  })

  it('recognises a Markdown routine served as plain text', async () => {
    const result = await fetchSource(PUBLISHED, {
      fetcher: serving('# Block 2\n- Squat 5x5', {
        headers: { 'content-type': 'text/plain' },
      }),
    })

    expect(result.format).toBe('text')
  })

  it('asks for a fresh copy, or an edit would never be seen', async () => {
    let seen: RequestInit | undefined
    const fetcher: Fetcher = async (_url, init) => {
      seen = init
      return new Response('a,b', { headers: { 'content-type': 'text/csv' } })
    }

    await fetchSource(PUBLISHED, { fetcher })

    expect(seen?.cache).toBe('no-store')
  })

  it('explains an HTML body rather than letting the parser chew on it', async () => {
    await expect(
      fetchSource(PUBLISHED, {
        fetcher: serving('<!DOCTYPE html><html><body>Sign in</body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      }),
    ).rejects.toThrow(/web page/)
  })

  it('reports an unpublished link as gone', async () => {
    await expect(
      fetchSource(PUBLISHED, { fetcher: serving('nope', { status: 404 }) }),
    ).rejects.toThrow(/unpublished/)
  })

  it('reports other failure statuses', async () => {
    await expect(
      fetchSource(PUBLISHED, { fetcher: serving('nope', { status: 500 }) }),
    ).rejects.toThrow(/500/)
  })

  it('rejects an empty file', async () => {
    await expect(fetchSource(PUBLISHED, { fetcher: serving('   ') })).rejects.toThrow(/empty/)
  })

  it('rejects a response far too large to be a routine', async () => {
    await expect(
      fetchSource(PUBLISHED, { fetcher: serving('x'.repeat(1_000_001)) }),
    ).rejects.toThrow(/too much data/)
  })

  it('turns a network failure into a SourceError, never a raw throw', async () => {
    const fetcher: Fetcher = async () => {
      throw new TypeError('Failed to fetch')
    }

    // Being offline is this app's normal state, so it has to arrive as an
    // outcome the caller can swallow rather than an exception.
    await expect(fetchSource(PUBLISHED, { fetcher })).rejects.toThrow(SourceError)
    await expect(fetchSource(PUBLISHED, { fetcher })).rejects.toThrow(/Could not reach/)
  })

  it('reports a timeout as its own thing', async () => {
    const fetcher: Fetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })

    await expect(fetchSource(PUBLISHED, { fetcher, timeoutMs: 10 })).rejects.toThrow(/too long/)
  })
})
