import type { E1rmFormula, Exercise, SetEntry } from '../db/schema'
import { countsAsWorkingSet, movedLoad } from './format'

/**
 * Pure derived values. Nothing here reads or writes the database, which is what
 * keeps it unit-testable and out of React.
 */

/**
 * Load moved, in kg. Assistance (a negative weight, as on assisted pull-ups)
 * clamps to zero rather than subtracting from the total — you are not moving
 * negative external load.
 */
export function volumeLoad(set: SetEntry): number {
  // Continuations count here even though they are not separate sets: the reps
  // in a drop set are real work. Only warm-ups are excluded.
  if (!movedLoad(set.setType)) return 0
  const w = Math.max(0, set.weightKg ?? 0)
  // On unilateral work `reps` is the count per limb, so the set moved that load
  // twice. The set carries its own perSide flag rather than reading it off the
  // exercise, so tonnage cannot change retroactively.
  const sides = set.perSide ? 2 : 1
  return w * (set.reps ?? 0) * sides
}

export function sessionVolume(sets: SetEntry[]): number {
  return sets.reduce((sum, s) => (s.isComplete ? sum + volumeLoad(s) : sum), 0)
}

// ------------------------------------------------------------------- 1RM

/**
 * Rep-based one-rep-max estimate. Both formulas degrade above ~12 reps; callers
 * that care should prefer `estimate1rmFromSet`, which uses RPE when present.
 */
export function estimate1rm(
  weightKg: number,
  reps: number,
  formula: E1rmFormula = 'epley',
): number | undefined {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return undefined
  if (!Number.isFinite(reps) || reps < 1) return undefined
  if (reps === 1) return weightKg
  if (formula === 'brzycki') {
    if (reps >= 37) return undefined // denominator hits zero
    return weightKg * (36 / (37 - reps))
  }
  return weightKg * (1 + reps / 30)
}

/**
 * Percentage of 1RM by reps and RPE — the RTS/Helms chart. Rows are reps 1-12,
 * columns RPE 10 down to 6 in half-point steps. Far more accurate than a rep
 * formula on a heavy low-rep set, where the reps alone say little.
 */
const RPE_CHART: Record<number, number[]> = {
  // RPE:  10    9.5    9     8.5    8     7.5    7     6.5    6
  1: [100.0, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3],
  2: [95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7],
  3: [92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1],
  4: [89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6],
  5: [86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2],
  6: [83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9],
  7: [81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7],
  8: [78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0],
  9: [76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0, 66.7, 65.3],
  10: [73.9, 72.3, 70.7, 69.4, 68.0, 66.7, 65.3, 64.0, 62.6],
  11: [70.7, 69.4, 68.0, 66.7, 65.3, 64.0, 62.6, 61.3, 59.9],
  12: [68.0, 66.7, 65.3, 64.0, 62.6, 61.3, 59.9, 58.6, 57.2],
}

/** Fraction of 1RM a set at `reps` and `rpe` represents, or undefined if off-chart. */
export function percentOf1rm(reps: number, rpe: number): number | undefined {
  const row = RPE_CHART[Math.round(reps)]
  if (!row) return undefined
  // Column 0 is RPE 10, each step down is 0.5.
  const idx = Math.round((10 - rpe) * 2)
  const pct = row[idx]
  return pct === undefined ? undefined : pct / 100
}

export function rpeAdjusted1rm(weightKg: number, reps: number, rpe: number): number | undefined {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return undefined
  const pct = percentOf1rm(reps, rpe)
  if (!pct) return undefined
  return weightKg / pct
}

/**
 * Best available 1RM estimate for a set: RPE-adjusted when the set carries an
 * effort rating, otherwise the configured rep formula.
 */
export function estimate1rmFromSet(set: SetEntry, formula: E1rmFormula = 'epley'): number | undefined {
  if (!countsAsWorkingSet(set.setType)) return undefined
  const { weightKg, reps } = set
  if (weightKg === undefined || weightKg <= 0 || reps === undefined || reps < 1) return undefined

  if (set.effortValue !== undefined && set.effortType) {
    const rpe = set.effortType === 'rir' ? 10 - set.effortValue : set.effortValue
    const adjusted = rpeAdjusted1rm(weightKg, reps, rpe)
    if (adjusted) return adjusted
  }
  return estimate1rm(weightKg, reps, formula)
}

// ------------------------------------------------------- personal records

export interface PrFlags {
  /** Heaviest weight ever moved on this lift, for any rep count. */
  weight: boolean
  /** More reps than ever before at this exact weight. */
  reps: boolean
  /** Highest estimated 1RM. */
  e1rm: boolean
  any: boolean
}

const NO_PR: PrFlags = { weight: false, reps: false, e1rm: false, any: false }

/**
 * Compares a set against every prior set of the same exercise.
 * `history` must exclude the candidate itself. Warm-ups never set records.
 */
export function detectPrs(
  candidate: SetEntry,
  history: SetEntry[],
  formula: E1rmFormula = 'epley',
): PrFlags {
  if (!countsAsWorkingSet(candidate.setType)) return NO_PR
  if (candidate.weightKg === undefined || candidate.reps === undefined) return NO_PR
  if (candidate.reps < 1) return NO_PR

  const prior = history.filter(
    (s) => s.id !== candidate.id && s.isComplete && countsAsWorkingSet(s.setType),
  )
  if (prior.length === 0) {
    // The very first working set of a lift is a baseline, not a record.
    return NO_PR
  }

  const bestWeight = Math.max(...prior.map((s) => s.weightKg ?? -Infinity))
  const weight = candidate.weightKg > bestWeight

  const atSameWeight = prior.filter((s) => s.weightKg === candidate.weightKg)
  const reps =
    atSameWeight.length > 0 && candidate.reps > Math.max(...atSameWeight.map((s) => s.reps ?? 0))

  const candidate1rm = estimate1rmFromSet(candidate, formula)
  const best1rm = Math.max(
    ...prior.map((s) => estimate1rmFromSet(s, formula) ?? -Infinity),
    -Infinity,
  )
  const e1rm =
    candidate1rm !== undefined && Number.isFinite(best1rm) && candidate1rm > best1rm + 0.001

  return { weight, reps, e1rm, any: weight || reps || e1rm }
}

/**
 * Walks a lift's history oldest-first, flagging each set against the records
 * standing at that moment. One pass, rather than re-scanning history per set.
 */
export function runningPrs(
  history: SetEntry[],
  formula: E1rmFormula = 'epley',
): { set: SetEntry; prs: PrFlags }[] {
  const out: { set: SetEntry; prs: PrFlags }[] = []
  let bestWeight = -Infinity
  let best1rm = -Infinity
  const bestRepsAtWeight = new Map<number, number>()
  let seen = 0

  for (const set of history) {
    if (!set.isComplete || !countsAsWorkingSet(set.setType)) continue
    if (set.weightKg === undefined || set.reps === undefined || set.reps < 1) continue

    const e1rm = estimate1rmFromSet(set, formula)
    const priorReps = bestRepsAtWeight.get(set.weightKg)

    // The first working set of a lift is a baseline, not a record.
    const prs: PrFlags =
      seen === 0
        ? { weight: false, reps: false, e1rm: false, any: false }
        : {
            weight: set.weightKg > bestWeight,
            reps: priorReps !== undefined && set.reps > priorReps,
            e1rm: e1rm !== undefined && e1rm > best1rm + 0.001,
            any: false,
          }
    prs.any = prs.weight || prs.reps || prs.e1rm
    out.push({ set, prs })

    bestWeight = Math.max(bestWeight, set.weightKg)
    if (e1rm !== undefined) best1rm = Math.max(best1rm, e1rm)
    bestRepsAtWeight.set(set.weightKg, Math.max(priorReps ?? 0, set.reps))
    seen++
  }
  return out
}

/** The heaviest completed working set, used for the "last time" hint. */
export function topSet(sets: SetEntry[]): SetEntry | undefined {
  const working = sets.filter((s) => s.isComplete && countsAsWorkingSet(s.setType))
  if (working.length === 0) return undefined
  return working.reduce((best, s) =>
    (s.weightKg ?? 0) > (best.weightKg ?? 0) ? s : best,
  )
}

/** The most recent prior session's sets for one exercise, grouped by date. */
export function lastTimeSets(history: SetEntry[], excludeSessionId?: string): SetEntry[] {
  const prior = history.filter((s) => s.sessionId !== excludeSessionId && s.isComplete)
  const last = prior[prior.length - 1]
  if (!last) return []
  return prior.filter((s) => s.sessionId === last.sessionId)
}

// ------------------------------------------------------------------ volume

/**
 * Hard working sets per muscle over a set of entries. Only counts exercises
 * that have been tagged with muscles; untagged lifts are silently skipped, so
 * the number is honest about what it knows.
 */
export function hardSetsPerMuscle(
  sets: SetEntry[],
  exercises: Map<string, Exercise>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const set of sets) {
    if (!set.isComplete || !countsAsWorkingSet(set.setType)) continue
    const ex = exercises.get(set.exerciseId)
    if (!ex) continue
    for (const m of ex.primaryMuscles) out[m] = (out[m] ?? 0) + 1
    // Secondary involvement is conventionally counted as half a set.
    for (const m of ex.secondaryMuscles) out[m] = (out[m] ?? 0) + 0.5
  }
  return out
}

/**
 * Seconds between ticking one set and ticking the one before it.
 *
 * This is **not rest**, and is deliberately not named as though it were. It is
 * a write-time interval: if sets are ticked out of order, or several at once
 * after the fact, the number means nothing. So it is only emitted where the
 * timestamps run forward in set order, and left blank otherwise — a blank is
 * more useful than a number that cannot be trusted.
 *
 * Ordering is by set position rather than by timestamp, because sorting by
 * timestamp hides exactly the out-of-order case this needs to detect.
 */
export function loggedGaps(sessionSets: SetEntry[]): Map<string, number> {
  const ordered = [...sessionSets].sort(
    (a, b) => a.order - b.order || a.setNumber - b.setNumber,
  )

  const out = new Map<string, number>()
  let previous: SetEntry | undefined

  for (const set of ordered) {
    if (set.status !== 'completed' || !set.loggedAt) {
      // A gap across a skipped or unlogged set is not an interval between two
      // efforts, so the chain restarts rather than spanning it.
      previous = undefined
      continue
    }
    if (previous?.loggedAt) {
      const gap =
        (new Date(set.loggedAt).getTime() - new Date(previous.loggedAt).getTime()) / 1000
      if (gap > 0) out.set(set.id, Math.round(gap))
    }
    previous = set
  }
  return out
}
