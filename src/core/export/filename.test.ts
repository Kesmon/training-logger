import { describe, expect, it } from 'vitest'
import type { Session } from '../../db/schema'
import { allSessionsFilename, sessionFilename } from './filename'

const session = (id: string, date: string, startedAt: string): Session => ({
  id,
  date,
  startedAt,
  isComplete: 1,
})

describe('sessionFilename', () => {
  it('always carries an index, so names stay uniform', () => {
    // Not special-casing the first session means an existing file never has to
    // be renamed when a second session appears the same day.
    const s = session('a', '2026-07-28', '2026-07-28T12:00:00Z')
    expect(sessionFilename(s, [s])).toBe('training-log-2026-07-28-S1.csv')
  })

  it('suffixes the second session of the same day rather than colliding', () => {
    const morning = session('a', '2026-07-28', '2026-07-28T08:00:00Z')
    const evening = session('b', '2026-07-28', '2026-07-28T18:00:00Z')
    const day = [morning, evening]

    expect(sessionFilename(morning, day)).toBe('training-log-2026-07-28-S1.csv')
    expect(sessionFilename(evening, day)).toBe('training-log-2026-07-28-S2.csv')
  })

  it('is stable regardless of the order sessions arrive in', () => {
    const morning = session('a', '2026-07-28', '2026-07-28T08:00:00Z')
    const evening = session('b', '2026-07-28', '2026-07-28T18:00:00Z')
    expect(sessionFilename(evening, [evening, morning])).toBe('training-log-2026-07-28-S2.csv')
  })

  it('ignores sessions from other days', () => {
    const target = session('a', '2026-07-28', '2026-07-28T12:00:00Z')
    const other = session('b', '2026-07-27', '2026-07-27T12:00:00Z')
    expect(sessionFilename(target, [target, other])).toBe('training-log-2026-07-28-S1.csv')
  })

  it('gives the same name twice, so re-sending replaces rather than duplicates', () => {
    const s = session('a', '2026-07-28', '2026-07-28T12:00:00Z')
    expect(sessionFilename(s, [s])).toBe(sessionFilename(s, [s]))
  })

  it('takes an extension', () => {
    const s = session('a', '2026-07-28', '2026-07-28T12:00:00Z')
    expect(sessionFilename(s, [s], 'json')).toBe('training-log-2026-07-28-S1.json')
  })
})

describe('allSessionsFilename', () => {
  it('is dated so successive full exports do not overwrite each other', () => {
    expect(allSessionsFilename('2026-07-28')).toBe('training-log-all-2026-07-28.csv')
  })
})
