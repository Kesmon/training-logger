/** The shape both importers produce, so one preview screen handles both. */

export interface ParsedItem {
  exercise: string
  plannedSets: number
  /** Free text such as "5x3+ T1" — shown while lifting, never enforced. */
  note?: string
}

export interface ParsedDay {
  name: string
  items: ParsedItem[]
}

export interface ParsedRoutine {
  name: string
  days: ParsedDay[]
  source: 'csv' | 'text'
  /** Non-fatal notes about what the parser had to guess or skip. */
  warnings: string[]
}

export const DEFAULT_SETS = 3
const MAX_SETS = 30

export function clampSets(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n) || n < 1) return DEFAULT_SETS
  return Math.min(Math.round(n), MAX_SETS)
}

/**
 * Pulls a set count out of free text: "5x5", "3 × 10", "5x3+", "4 sets of 8".
 * Returns the text before the match as the exercise name, since people write
 * the scheme after the movement.
 */
export function extractSets(line: string): { name: string; sets?: number; note?: string } {
  const cross = line.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (cross && cross.index !== undefined) {
    const name = line.slice(0, cross.index).trim()
    const note = line.slice(cross.index).trim()
    // A leading match means the line is like "5x5 Squat" — the name follows.
    if (!name) {
      return { name: note.replace(cross[0], '').trim(), sets: Number(cross[1]), note: cross[0] }
    }
    return { name, sets: Number(cross[1]), note: note || undefined }
  }

  const sets = line.match(/(\d+)\s*(?:sets?|sett)\b/i)
  if (sets && sets.index !== undefined) {
    const name = line.slice(0, sets.index).trim()
    const note = line.slice(sets.index).trim()
    if (name) return { name, sets: Number(sets[1]), note: note || undefined }
  }

  return { name: line.trim() }
}
