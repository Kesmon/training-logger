import type { Exercise, SetEntry } from '../../db/schema'
import { setCategory } from '../format'
import { loggedGaps, volumeLoad } from '../metrics'
import { csvStyle, type CsvFlavor, type ExportBundle } from './types'

/**
 * The coach-facing export: one row per set, carrying what was prescribed
 * alongside what was done.
 *
 * Bumped whenever the column set changes. It is what separates "the app could
 * not capture this yet" from "she did not enter it" — without it, a blank cell
 * in an old file and a blank cell in a new one are indistinguishable, which was
 * the real complaint behind always-empty columns.
 */
export const SCHEMA_VERSION = 3

const COLUMNS = [
  'schema_version',
  'date',
  'routine_id',
  'routine_name',
  'routine_version',
  'session_id',
  'day_name',
  'exercise_id',
  'exercise_name',
  'exercise_alias_of',
  'primary_muscles',
  'set_number',
  'working_set_number',
  'set_type',
  'set_category',
  'set_status',
  'is_extra',
  'planned_sets',
  'planned_reps_min',
  'planned_reps_max',
  'planned_duration_sec',
  'planned_note',
  'weight_kg',
  'reps',
  'per_side',
  'duration_sec',
  'distance_m',
  'effort_type',
  'effort_value',
  'tempo',
  'volume_kg',
  'performed_at',
  'logged_at',
  'logged_gap_sec',
  'set_note',
  'session_rpe',
  'bodyweight_kg',
  'session_note',
] as const

/**
 * Excel on Windows reads a UTF-8 file as the ANSI codepage unless it starts
 * with this, turning "Markløft" into "MarklÃ¸ft". Written as an escape rather
 * than a literal so it stays visible in diffs and survives editors.
 */
export const UTF8_BOM = '﻿'

function escape(value: string, delimiter: string): string {
  // RFC 4180: quote if the value contains the delimiter, a quote, or a newline.
  if (value.includes(delimiter) || /["\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Position among an exercise's *working* sets, and whether that position went
 * beyond what was prescribed.
 *
 * Both have to skip warm-ups and continuations. `set_number` counts every row,
 * so comparing it against `planned_sets` flags prescribed work as extra the
 * moment a warm-up or a drop set exists — which for this programme is every
 * session.
 */
function positions(sets: SetEntry[]): Map<string, { working?: number; isExtra?: boolean }> {
  const out = new Map<string, { working?: number; isExtra?: boolean }>()
  const byBlock = new Map<string, SetEntry[]>()

  for (const set of sets) {
    const key = `${set.sessionId}::${set.exerciseId}`
    if (!byBlock.has(key)) byBlock.set(key, [])
    byBlock.get(key)!.push(set)
  }

  for (const block of byBlock.values()) {
    block.sort((a, b) => a.order - b.order || a.setNumber - b.setNumber)
    let working = 0
    for (const set of block) {
      if (setCategory(set.setType) !== 'working') {
        out.set(set.id, {})
        continue
      }
      working++
      out.set(set.id, {
        working,
        // Undefined rather than false when nothing was prescribed: a set in a
        // free session is not "not extra", there is simply nothing to exceed.
        isExtra: set.plannedSets === undefined ? undefined : working > set.plannedSets,
      })
    }
  }
  return out
}

export function bundleToCsv(bundle: ExportBundle, flavor: CsvFlavor = 'international'): string {
  const { delimiter, decimal } = csvStyle(flavor)
  const sessions = new Map(bundle.sessions.map((s) => [s.id, s]))
  const exercises = new Map<string, Exercise>(bundle.exercises.map((e) => [e.id, e]))
  const finished = new Set(bundle.sessions.filter((s) => s.isComplete).map((s) => s.id))

  // From a finished session, every row is meaningful: a set that was planned
  // and not done is exactly the fact a coach cannot otherwise recover. From a
  // session still in progress only completed sets are exported, since its
  // untouched rows are simply work not yet reached.
  const entries = bundle.setEntries.filter((s) => s.isComplete || finished.has(s.sessionId))

  const num = (n: number | undefined, dp = 2): string => {
    if (n === undefined || n === null || !Number.isFinite(n)) return ''
    const s = String(Number(n.toFixed(dp)))
    return decimal === ',' ? s.replace('.', ',') : s
  }
  const bool = (b: boolean | undefined): string => (b === undefined ? '' : String(b))

  // Gaps are per-session, so they are computed session by session.
  const gaps = new Map<string, number>()
  const bySession = new Map<string, SetEntry[]>()
  for (const set of entries) {
    if (!bySession.has(set.sessionId)) bySession.set(set.sessionId, [])
    bySession.get(set.sessionId)!.push(set)
  }
  for (const sets of bySession.values()) {
    for (const [id, gap] of loggedGaps(sets)) gaps.set(id, gap)
  }

  const place = positions(entries)

  const ordered = [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.order - b.order ||
      a.setNumber - b.setNumber,
  )

  const lines = [COLUMNS.join(delimiter)]

  for (const set of ordered) {
    const session = sessions.get(set.sessionId)
    const exercise = exercises.get(set.exerciseId)
    const at = place.get(set.id) ?? {}
    const performed = set.status === 'completed'

    // A row that was never performed carries no performance data, even though
    // the app may have pre-filled it: new sets are seeded from the previous
    // one, so an untouched row can hold a weight and rep count that were never
    // lifted. Exporting those would invent training that did not happen.
    const row = [
      String(SCHEMA_VERSION),
      set.date,
      session?.routineId ?? '',
      session?.routineName ?? '',
      num(session?.routineVersion, 0),
      set.sessionId,
      session?.dayName ?? '',
      set.exerciseId,
      set.exerciseName,
      // Only present when the routine called it something else.
      set.plannedExerciseName && set.plannedExerciseName !== set.exerciseName
        ? set.plannedExerciseName
        : '',
      (exercise?.primaryMuscles ?? []).join(';'),
      String(set.setNumber),
      num(at.working, 0),
      set.setType,
      setCategory(set.setType),
      set.status === 'planned' ? 'not_logged' : set.status,
      bool(at.isExtra),
      num(set.plannedSets, 0),
      num(set.plannedRepsMin, 0),
      num(set.plannedRepsMax, 0),
      num(set.plannedDurationSec, 0),
      set.plannedNote ?? '',
      performed ? num(set.weightKg) : '',
      performed ? num(set.reps, 0) : '',
      // Whether `reps` is per limb. Blank on bilateral work rather than
      // 'false', so it reads as "not applicable" instead of "checked and no".
      set.perSide ? 'true' : '',
      performed ? num(set.timeSec, 0) : '',
      performed ? num(set.distanceM) : '',
      performed && set.effortValue !== undefined ? (set.effortType ?? '') : '',
      performed ? num(set.effortValue, 1) : '',
      performed ? (set.tempo ?? '') : '',
      performed && volumeLoad(set) > 0 ? num(volumeLoad(set)) : '',
      '', // performed_at — reserved; the app has no notion of it yet
      performed ? (set.loggedAt ?? '') : '',
      num(gaps.get(set.id), 0),
      set.notes ?? '',
      num(session?.sessionRpe, 1),
      num(session?.bodyweightKg),
      session?.notes ?? '',
    ]
    lines.push(row.map((v) => escape(v, delimiter)).join(delimiter))
  }

  return lines.join('\r\n')
}
