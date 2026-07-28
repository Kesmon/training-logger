import { describe, expect, it } from 'vitest'
import type { SetEntry, SetType } from '../db/schema'
import {
  detectPrs,
  estimate1rm,
  estimate1rmFromSet,
  percentOf1rm,
  restIntervals,
  rpeAdjusted1rm,
  runningPrs,
  volumeLoad,
} from './metrics'

let counter = 0
function makeSet(over: Partial<SetEntry> = {}): SetEntry {
  counter++
  return {
    id: `s${counter}`,
    sessionId: 'sess1',
    exerciseId: 'ex1',
    exerciseName: 'Squat',
    date: '2026-07-01',
    order: 0,
    setNumber: counter,
    setType: 'working' as SetType,
    status: 'completed',
    isComplete: 1,
    ...over,
  }
}

describe('volumeLoad', () => {
  it('multiplies weight by reps', () => {
    expect(volumeLoad(makeSet({ weightKg: 100, reps: 5 }))).toBe(500)
  })

  it('excludes warm-ups', () => {
    expect(volumeLoad(makeSet({ weightKg: 100, reps: 5, setType: 'warmup' }))).toBe(0)
  })

  it('clamps assistance to zero rather than going negative', () => {
    // An assisted pull-up stores -20 kg; that is not negative external load.
    expect(volumeLoad(makeSet({ weightKg: -20, reps: 8 }))).toBe(0)
  })

  it('is zero when reps or weight are missing', () => {
    expect(volumeLoad(makeSet({ weightKg: 100 }))).toBe(0)
    expect(volumeLoad(makeSet({ reps: 5 }))).toBe(0)
  })
})

describe('estimate1rm', () => {
  it('returns the weight itself for a single', () => {
    expect(estimate1rm(140, 1, 'epley')).toBe(140)
    expect(estimate1rm(140, 1, 'brzycki')).toBe(140)
  })

  it('matches Epley by hand: 100 x 5 -> 100 * (1 + 5/30)', () => {
    expect(estimate1rm(100, 5, 'epley')).toBeCloseTo(116.667, 3)
  })

  it('matches Brzycki by hand: 100 x 5 -> 100 * 36/32', () => {
    expect(estimate1rm(100, 5, 'brzycki')).toBeCloseTo(112.5, 3)
  })

  it('rejects nonsense input', () => {
    expect(estimate1rm(0, 5)).toBeUndefined()
    expect(estimate1rm(100, 0)).toBeUndefined()
    // Brzycki's denominator hits zero at 37 reps.
    expect(estimate1rm(100, 37, 'brzycki')).toBeUndefined()
  })
})

describe('RPE chart', () => {
  it('reads the standard table', () => {
    expect(percentOf1rm(1, 10)).toBeCloseTo(1.0, 5)
    expect(percentOf1rm(5, 8)).toBeCloseTo(0.811, 5)
    expect(percentOf1rm(8, 9)).toBeCloseTo(0.762, 5)
    expect(percentOf1rm(12, 6)).toBeCloseTo(0.572, 5)
  })

  it('is undefined off the chart', () => {
    expect(percentOf1rm(13, 8)).toBeUndefined()
    expect(percentOf1rm(5, 5)).toBeUndefined()
  })

  it('converts a rated set to a 1RM', () => {
    // 100 kg x 5 @8 is 81.1% of max.
    expect(rpeAdjusted1rm(100, 5, 8)).toBeCloseTo(123.305, 2)
  })
})

describe('estimate1rmFromSet', () => {
  it('prefers the RPE chart over the rep formula when effort is recorded', () => {
    const set = makeSet({ weightKg: 100, reps: 5, effortType: 'rpe', effortValue: 8 })
    expect(estimate1rmFromSet(set, 'epley')).toBeCloseTo(123.305, 2)
  })

  it('converts RIR to RPE first', () => {
    // 2 RIR is RPE 8, so this must agree with the case above.
    const set = makeSet({ weightKg: 100, reps: 5, effortType: 'rir', effortValue: 2 })
    expect(estimate1rmFromSet(set, 'epley')).toBeCloseTo(123.305, 2)
  })

  it('falls back to the rep formula with no effort rating', () => {
    expect(estimate1rmFromSet(makeSet({ weightKg: 100, reps: 5 }), 'epley')).toBeCloseTo(116.667, 3)
  })

  it('ignores warm-ups', () => {
    expect(
      estimate1rmFromSet(makeSet({ weightKg: 100, reps: 5, setType: 'warmup' })),
    ).toBeUndefined()
  })
})

describe('detectPrs', () => {
  const history = [
    makeSet({ id: 'h1', weightKg: 100, reps: 5 }),
    makeSet({ id: 'h2', weightKg: 110, reps: 3 }),
  ]

  it('flags a heavier top weight', () => {
    const prs = detectPrs(makeSet({ id: 'c', weightKg: 120, reps: 1 }), history)
    expect(prs.weight).toBe(true)
    expect(prs.any).toBe(true)
  })

  it('flags more reps at a weight already lifted', () => {
    const prs = detectPrs(makeSet({ id: 'c', weightKg: 100, reps: 8 }), history)
    expect(prs.reps).toBe(true)
    expect(prs.weight).toBe(false)
  })

  it('does not claim a rep PR at a weight never lifted before', () => {
    const prs = detectPrs(makeSet({ id: 'c', weightKg: 95, reps: 20 }), history)
    expect(prs.reps).toBe(false)
  })

  it('flags a higher estimated 1RM', () => {
    // 105 x 5 estimates above both 100 x 5 and 110 x 3.
    const prs = detectPrs(makeSet({ id: 'c', weightKg: 105, reps: 5 }), history)
    expect(prs.e1rm).toBe(true)
  })

  it('finds nothing on an easier set', () => {
    expect(detectPrs(makeSet({ id: 'c', weightKg: 80, reps: 3 }), history).any).toBe(false)
  })

  it('never fires on a warm-up', () => {
    const prs = detectPrs(makeSet({ id: 'c', weightKg: 200, reps: 5, setType: 'warmup' }), history)
    expect(prs.any).toBe(false)
  })

  it('treats the very first working set as a baseline, not a record', () => {
    expect(detectPrs(makeSet({ id: 'c', weightKg: 100, reps: 5 }), []).any).toBe(false)
  })

  it('ignores the candidate appearing in its own history', () => {
    const candidate = makeSet({ id: 'dup', weightKg: 120, reps: 2 })
    expect(detectPrs(candidate, [...history, candidate]).weight).toBe(true)
  })
})

describe('runningPrs', () => {
  it('flags each set against the records standing at that moment', () => {
    const history = [
      makeSet({ id: 'a', weightKg: 100, reps: 5, loggedAt: '2026-07-01T10:00:00Z' }),
      makeSet({ id: 'b', weightKg: 105, reps: 5, loggedAt: '2026-07-08T10:00:00Z' }),
      makeSet({ id: 'c', weightKg: 90, reps: 5, loggedAt: '2026-07-15T10:00:00Z' }),
      makeSet({ id: 'd', weightKg: 105, reps: 7, loggedAt: '2026-07-22T10:00:00Z' }),
    ]
    const flags = runningPrs(history)
    expect(flags.map((f) => f.prs.any)).toEqual([false, true, false, true])
    expect(flags[1]!.prs.weight).toBe(true)
    expect(flags[3]!.prs.reps).toBe(true)
    expect(flags[3]!.prs.weight).toBe(false)
  })

  it('agrees with detectPrs run set by set', () => {
    const history = [
      makeSet({ id: 'a', weightKg: 100, reps: 5 }),
      makeSet({ id: 'b', weightKg: 110, reps: 3 }),
      makeSet({ id: 'c', weightKg: 105, reps: 5 }),
    ]
    const running = runningPrs(history)
    for (const [i, entry] of running.entries()) {
      const oneOff = detectPrs(entry.set, history.slice(0, i))
      expect(entry.prs.any).toBe(oneOff.any)
    }
  })
})

describe('restIntervals', () => {
  it('derives rest from the logged timestamps, with no timer involved', () => {
    const sets = [
      makeSet({ id: 'a', loggedAt: '2026-07-01T10:00:00Z' }),
      makeSet({ id: 'b', loggedAt: '2026-07-01T10:02:30Z' }),
      makeSet({ id: 'c', loggedAt: '2026-07-01T10:05:00Z' }),
    ]
    const rests = restIntervals(sets)
    expect(rests.get('a')).toBeUndefined() // nothing before the first set
    expect(rests.get('b')).toBe(150)
    expect(rests.get('c')).toBe(150)
  })

  it('skips sets that were never completed', () => {
    const sets = [
      makeSet({ id: 'a', loggedAt: '2026-07-01T10:00:00Z' }),
      makeSet({ id: 'b', isComplete: 0 }),
    ]
    expect(restIntervals(sets).size).toBe(0)
  })
})
