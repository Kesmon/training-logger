/** The shape both importers produce, so one preview screen handles both. */

export interface ParsedItem {
  exercise: string
  plannedSets: number
  /** Free text such as "5x3+ T1" — shown while lifting, never enforced. */
  note?: string
  /**
   * Whether a set scheme was actually recognised on the line. A line with no
   * scheme is a guess, and a guess must never silently become an exercise.
   */
  recognised: boolean
  /**
   * The set count before clamping. `Squat 40x5` clamps to 30, and the preview
   * needs the 40 to ask whether 40 kg was meant.
   */
  rawSets?: number
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

/** Separators and stray punctuation left dangling on the end of a name. */
const TRAILING_JUNK = /[\s@:;,.\-–—*+_/|]+$/
/** A bare scheme fragment: the "x6" in "chest row   x6 @". */
const TRAILING_SCHEME = /\s+[x×]\s*\d*$/i

/**
 * Tidies a name pulled off a line that did not fully parse.
 *
 * `chest row   x6 @` became an exercise called exactly that, which then sat in
 * the library forever and split the real chest row history in two. Collapsing
 * whitespace and shedding trailing scheme fragments turns it back into
 * `chest row`, which matches the entry that already exists.
 *
 * Deliberately conservative: it only strips from the end, so a legitimate name
 * like `T-Bar Row` or `Squat (paused)` is untouched.
 */
export function cleanExerciseName(raw: string): string {
  let out = raw.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 5; i++) {
    const next = out.replace(TRAILING_JUNK, '').replace(TRAILING_SCHEME, '')
    if (next === out) break
    out = next
  }
  return out.trim()
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
      return {
        name: cleanExerciseName(note.replace(cross[0], '')),
        sets: Number(cross[1]),
        note: cross[0],
      }
    }
    return { name: cleanExerciseName(name), sets: Number(cross[1]), note: note || undefined }
  }

  const sets = line.match(/(\d+)\s*(?:sets?|sett)\b/i)
  if (sets && sets.index !== undefined) {
    const name = line.slice(0, sets.index).trim()
    const note = line.slice(sets.index).trim()
    if (name) {
      return { name: cleanExerciseName(name), sets: Number(sets[1]), note: note || undefined }
    }
  }

  // No scheme found. The whole line is the name, so it gets the most cleanup —
  // this is the path that produced "chest row   x6 @".
  return { name: cleanExerciseName(line) }
}
