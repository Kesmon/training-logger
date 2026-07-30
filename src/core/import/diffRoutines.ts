/**
 * What actually changed between two revisions of a routine.
 *
 * Two jobs. The first is trust: a training plan that rewrites itself silently is
 * unsettling, and "Day A · Squat 5 → 4 sets" is the difference between an
 * update you believe and one you have to go and verify against the sheet.
 *
 * The second is avoiding version churn. A changed source hash is not the same
 * as a changed routine — a trailing blank row in a spreadsheet moves the bytes
 * without touching the programme. An empty diff means the new source is
 * recorded but no version is cut.
 */

export interface SnapshotItem {
  exercise: string
  plannedSets: number
  plannedRepsMin?: number
  plannedRepsMax?: number
  plannedDurationSec?: number
  note?: string
}

export interface SnapshotDay {
  name: string
  items: SnapshotItem[]
}

/**
 * The comparable shape of a routine. Both an incoming `ParsedRoutine` and the
 * stored rows reduce to this, which is what keeps the comparison pure — it
 * never has to know that one side came from a database.
 */
export interface RoutineSnapshot {
  days: SnapshotDay[]
}

export type RoutineChange =
  | { kind: 'day-added'; day: string }
  | { kind: 'day-removed'; day: string }
  | { kind: 'exercise-added'; day: string; exercise: string }
  | { kind: 'exercise-removed'; day: string; exercise: string }
  | { kind: 'sets-changed'; day: string; exercise: string; from: number; to: number }
  | { kind: 'reps-changed'; day: string; exercise: string; from?: string; to?: string }
  | { kind: 'duration-changed'; day: string; exercise: string; from?: number; to?: number }
  | { kind: 'note-changed'; day: string; exercise: string }
  | { kind: 'reordered'; day: string }

function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
}

/**
 * A set scheme sitting at the front of a note.
 *
 * `extractSets` keeps everything from the scheme onward as the note, so the
 * line `Squat 5x5` yields the note `"5x5"` and `Squat 5x3+ T1` yields
 * `"5x3+ T1"`. Comparing notes raw would therefore report every set-count
 * change twice — once as sets, once as a note edit that nobody made.
 *
 * What matters is whether the coach's *words* changed, so the restated scheme
 * comes off before the comparison. `5x5 → 4x5` is silent; `5x5 → 4x5 belt on`
 * still reports the note.
 */
const LEADING_SCHEME =
  /^\s*\d+\s*[x×*]\s*\d+(?:\s*[-–]\s*\d+)?\s*(?:seconds|secs|sec|s|mins|min|m)?\b\s*/i

function noteBody(note: string | undefined): string {
  return (note ?? '').replace(LEADING_SCHEME, '').trim()
}

/** "8" · "8–10" · undefined when no reps were prescribed. */
export function repsText(item: Pick<SnapshotItem, 'plannedRepsMin' | 'plannedRepsMax'>): string | undefined {
  const { plannedRepsMin: min, plannedRepsMax: max } = item
  if (min === undefined) return undefined
  return max !== undefined && max !== min ? `${min}–${max}` : String(min)
}

/**
 * Whether two sequences of the same names run in the same relative order.
 * Compared on the shared members only, so adding an exercise does not also
 * report every exercise after it as reordered.
 */
function sameOrder(before: string[], after: string[]): boolean {
  const shared = new Set(before.filter((n) => after.includes(n)))
  const a = before.filter((n) => shared.has(n))
  const b = after.filter((n) => shared.has(n))
  return a.every((n, i) => b[i] === n)
}

export function diffRoutines(before: RoutineSnapshot, after: RoutineSnapshot): RoutineChange[] {
  const changes: RoutineChange[] = []

  const beforeDays = new Map(before.days.map((d) => [key(d.name), d]))
  const afterDays = new Map(after.days.map((d) => [key(d.name), d]))

  for (const [k, day] of beforeDays) {
    if (!afterDays.has(k)) changes.push({ kind: 'day-removed', day: day.name })
  }

  for (const [k, day] of afterDays) {
    const previous = beforeDays.get(k)
    if (!previous) {
      // A renamed day reads as one removed and one added. That is honest — the
      // parser has no identity for a day beyond its name, and inventing one
      // would guess wrong the first time two days were renamed at once.
      changes.push({ kind: 'day-added', day: day.name })
      continue
    }

    const was = new Map(previous.items.map((i) => [key(i.exercise), i]))
    const now = new Map(day.items.map((i) => [key(i.exercise), i]))

    for (const [ik, item] of was) {
      if (!now.has(ik)) {
        changes.push({ kind: 'exercise-removed', day: day.name, exercise: item.exercise })
      }
    }

    for (const [ik, item] of now) {
      const prior = was.get(ik)
      if (!prior) {
        changes.push({ kind: 'exercise-added', day: day.name, exercise: item.exercise })
        continue
      }

      if (prior.plannedSets !== item.plannedSets) {
        changes.push({
          kind: 'sets-changed',
          day: day.name,
          exercise: item.exercise,
          from: prior.plannedSets,
          to: item.plannedSets,
        })
      }

      const wasReps = repsText(prior)
      const nowReps = repsText(item)
      if (wasReps !== nowReps) {
        changes.push({
          kind: 'reps-changed',
          day: day.name,
          exercise: item.exercise,
          from: wasReps,
          to: nowReps,
        })
      }

      if (prior.plannedDurationSec !== item.plannedDurationSec) {
        changes.push({
          kind: 'duration-changed',
          day: day.name,
          exercise: item.exercise,
          from: prior.plannedDurationSec,
          to: item.plannedDurationSec,
        })
      }

      // The note carries the coach's own words — "T1", "3 RIR", "belt on". A
      // change to it is a change to the instruction, even when the numbers
      // hold; the scheme it restates is stripped first so it is not reported
      // twice.
      if (noteBody(prior.note) !== noteBody(item.note)) {
        changes.push({ kind: 'note-changed', day: day.name, exercise: item.exercise })
      }
    }

    if (
      !sameOrder(
        previous.items.map((i) => key(i.exercise)),
        day.items.map((i) => key(i.exercise)),
      )
    ) {
      changes.push({ kind: 'reordered', day: day.name })
    }
  }

  return changes
}

export function describeChange(change: RoutineChange): string {
  switch (change.kind) {
    case 'day-added':
      return `Added ${change.day}`
    case 'day-removed':
      return `Removed ${change.day}`
    case 'exercise-added':
      return `${change.day} · added ${change.exercise}`
    case 'exercise-removed':
      return `${change.day} · removed ${change.exercise}`
    case 'sets-changed':
      return `${change.day} · ${change.exercise} ${change.from} → ${change.to} sets`
    case 'reps-changed':
      return `${change.day} · ${change.exercise} ${change.from ?? 'no reps'} → ${change.to ?? 'no reps'} reps`
    case 'duration-changed':
      return `${change.day} · ${change.exercise} ${change.from ?? '–'}s → ${change.to ?? '–'}s`
    case 'note-changed':
      return `${change.day} · ${change.exercise} note changed`
    case 'reordered':
      return `${change.day} · reordered`
  }
}

/** The `ParsedRoutine` side of the comparison. */
export function snapshotOfParsed(parsed: {
  days: { name: string; items: SnapshotItem[] }[]
}): RoutineSnapshot {
  return {
    days: parsed.days.map((d) => ({
      name: d.name,
      items: d.items.map((i) => ({
        exercise: i.exercise,
        plannedSets: i.plannedSets,
        plannedRepsMin: i.plannedRepsMin,
        plannedRepsMax: i.plannedRepsMax,
        plannedDurationSec: i.plannedDurationSec,
        note: i.note,
      })),
    })),
  }
}
