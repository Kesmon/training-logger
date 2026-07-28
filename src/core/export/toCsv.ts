import type { E1rmFormula } from '../../db/schema'
import { estimate1rmFromSet, restIntervals, volumeLoad } from '../metrics'
import { csvStyle, type CsvFlavor, type ExportBundle } from './types'

const COLUMNS = [
  'date',
  'session_id',
  'routine',
  'day',
  'exercise',
  'set_number',
  'set_type',
  'weight_kg',
  'reps',
  'effort_type',
  'effort_value',
  'tempo',
  'time_sec',
  'distance_m',
  'volume_kg',
  'e1rm_kg',
  'rest_before_sec',
  'logged_at',
  'session_rpe',
  'bodyweight_kg',
  'notes',
] as const

/**
 * Excel on Windows reads a UTF-8 file as the ANSI codepage unless it starts
 * with this, turning "Markløft" into "MarklÃ¸ft". Written as an escape rather
 * than a literal so it stays visible in diffs and survives editors.
 */
export const UTF8_BOM = '\uFEFF'

function escape(value: string, delimiter: string): string {
  // RFC 4180: quote if the value contains the delimiter, a quote, or a newline.
  if (value.includes(delimiter) || /["\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * One row per logged set, with volume, estimated 1RM and rest time computed
 * here so the file is useful in a spreadsheet without writing any formulas.
 * Weights are always kg — the display unit is a UI preference, not data.
 */
export function bundleToCsv(
  bundle: ExportBundle,
  flavor: CsvFlavor = 'international',
  formula: E1rmFormula = 'epley',
): string {
  const { delimiter, decimal } = csvStyle(flavor)
  const sessions = new Map(bundle.sessions.map((s) => [s.id, s]))

  // Only ticked sets are logged training. An unfinished session still holds its
  // blank planned rows, and those would export as empty noise.
  const entries = bundle.setEntries.filter((s) => s.isComplete)

  const num = (n: number | undefined, dp = 2): string => {
    if (n === undefined || n === null || !Number.isFinite(n)) return ''
    const s = String(Number(n.toFixed(dp)))
    return decimal === ',' ? s.replace('.', ',') : s
  }

  // Rest intervals are per-session, so compute them session by session.
  const rests = new Map<string, number>()
  const bySession = new Map<string, typeof entries>()
  for (const set of entries) {
    if (!bySession.has(set.sessionId)) bySession.set(set.sessionId, [])
    bySession.get(set.sessionId)!.push(set)
  }
  for (const sets of bySession.values()) {
    for (const [id, gap] of restIntervals(sets)) rests.set(id, gap)
  }

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
    const volume = volumeLoad(set)
    const e1rm = estimate1rmFromSet(set, formula)

    const row = [
      set.date,
      set.sessionId,
      session?.routineName ?? '',
      session?.dayName ?? '',
      set.exerciseName,
      String(set.setNumber),
      set.setType,
      num(set.weightKg),
      num(set.reps, 0),
      set.effortType ?? '',
      num(set.effortValue, 1),
      set.tempo ?? '',
      num(set.timeSec, 0),
      num(set.distanceM),
      volume > 0 ? num(volume) : '',
      num(e1rm, 1),
      num(rests.get(set.id), 0),
      set.loggedAt ?? '',
      num(session?.sessionRpe, 1),
      num(session?.bodyweightKg),
      set.notes ?? '',
    ]
    lines.push(row.map((v) => escape(v, delimiter)).join(delimiter))
  }

  return lines.join('\r\n')
}
