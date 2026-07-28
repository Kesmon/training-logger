/** The shape both importers produce, so one preview screen handles both. */

export interface ParsedItem {
  exercise: string
  plannedSets: number
  /**
   * Prescribed reps. Always both or neither: a fixed `3x10` sets them equal,
   * a range `3x8-10` sets 8 and 10. A single column would have to either
   * truncate a range or stringify it, and both need parsing back out.
   */
  plannedRepsMin?: number
  plannedRepsMax?: number
  /** For timed work: the 30 in `Plank 3x30s`. */
  plannedDurationSec?: number
  /** "2x10 per leg" — one limb at a time. */
  unilateral?: boolean
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
export interface ExtractedScheme {
  name: string
  sets?: number
  repsMin?: number
  repsMax?: number
  durationSec?: number
  unilateral?: boolean
  note?: string
}

/** "per leg" · "each side" · "/side" · "per arm" — a third of her accessory work. */
const UNILATERAL = /\b(?:per|each|\/)\s*(?:leg|side|arm|hand|foot)\b|\bunilateral\b/i

export function isUnilateralLine(line: string): boolean {
  return UNILATERAL.test(line)
}

/**
 * `5x3` · `3 × 10` · `3x8-10` · `Plank 3x30s` · `Farmer's Walk 2x20m`
 *
 * The trailing unit matters: without it `2x20m` reads as twenty reps rather
 * than twenty metres, and `3x30s` as thirty reps rather than a thirty-second
 * hold. Both are in her programme, so the second number is only treated as reps
 * when nothing says otherwise.
 */
const SCHEME =
  /(\d+)\s*[x×*]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(seconds|secs|sec|s|mins|min|m)?\b/i

function unitOf(raw: string | undefined): 'reps' | 'seconds' | 'minutes' | 'distance' {
  if (!raw) return 'reps'
  const u = raw.toLowerCase()
  if (u === 'm') return 'distance'
  if (u.startsWith('min')) return 'minutes'
  return 'seconds'
}

export function extractSets(line: string): ExtractedScheme {
  // Read from the whole line: "per leg" trails the scheme, not the name.
  const unilateral = isUnilateralLine(line) || undefined

  const cross = line.match(SCHEME)
  if (cross && cross.index !== undefined) {
    const sets = Number(cross[1])
    const second = Number(cross[2])
    const unit = unitOf(cross[4])

    // A dash only opens a rep range when the number after it is larger. Coaches
    // write "2x6 — 3 RIR", where the dash separates a note rather than bounding
    // a range, and reading that as 6-to-3 inverts the prescription.
    const upper = cross[3] ? Number(cross[3]) : undefined
    const rangeTop = upper !== undefined && upper > second ? upper : second

    const measured: Pick<ExtractedScheme, 'repsMin' | 'repsMax' | 'durationSec'> =
      unit === 'reps'
        ? { repsMin: second, repsMax: rangeTop }
        : unit === 'seconds'
          ? { durationSec: second }
          : unit === 'minutes'
            ? { durationSec: second * 60 }
            : {} // a distance; the figure survives in the note

    const name = line.slice(0, cross.index).trim()
    const note = line.slice(cross.index).trim()
    // A leading match means the line is like "5x5 Squat" — the name follows.
    if (!name) {
      return {
        name: cleanExerciseName(note.replace(cross[0], '')),
        sets,
        ...measured,
        unilateral,
        note: cross[0],
      }
    }
    return { name: cleanExerciseName(name), sets, ...measured, unilateral, note: note || undefined }
  }

  const sets = line.match(/(\d+)\s*(?:sets?|sett)\b/i)
  if (sets && sets.index !== undefined) {
    const name = line.slice(0, sets.index).trim()
    const note = line.slice(sets.index).trim()
    if (name) {
      return { name: cleanExerciseName(name), sets: Number(sets[1]), unilateral, note: note || undefined }
    }
  }

  // No scheme found. The whole line is the name, so it gets the most cleanup —
  // this is the path that produced "chest row   x6 @".
  return { name: cleanExerciseName(line), unilateral }
}
