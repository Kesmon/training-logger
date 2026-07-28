import type { Exercise } from '../../db/schema'
import { cleanExerciseName } from '../import/types'

/**
 * Finds exercises that are really the same movement under different names.
 *
 * Fixing the parser stops new junk appearing; it does nothing for entries
 * already in the library with logged sets attached. This is the backwards
 * application of the same matching, so history split across `chest row   x6 @`
 * and `Chest row` can be put back together.
 */

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(normalise(s).split(' ').filter(Boolean))
}

function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / new Set([...ta, ...tb]).size
}

/**
 * Tokens that are a number, optionally with a unit — `30s`, `6`, `20m`. A real
 * movement name rarely contains one, so they usually mean a prescription
 * fragment stuck to the name: `plank 30s` rather than `Plank`.
 */
const NOISE_TOKEN = /^\d+[a-z]*$/i

function noiseScore(name: string): number {
  return normalise(name)
    .split(' ')
    .filter((t) => t && NOISE_TOKEN.test(t)).length
}

/** A name that still carries the wreckage of a line that failed to parse. */
export function looksUnparsed(name: string): boolean {
  return (
    /\s{2,}/.test(name) ||
    /[@|]/.test(name) ||
    /\s[x×]\s*\d*\s*$/i.test(name) ||
    /[-–—:;,.]\s*$/.test(name)
  )
}

export type MergeReason = 'identical' | 'prefix' | 'similar'

export interface MergeCandidate {
  /** The entry to keep. */
  canonical: Exercise
  /** Entries to fold into it, with their logged set counts. */
  duplicates: Exercise[]
  reason: MergeReason
}

export interface RenameSuggestion {
  exercise: Exercise
  suggested: string
}

export interface LibraryIssues {
  merges: MergeCandidate[]
  renames: RenameSuggestion[]
}

function relation(a: string, b: string): MergeReason | null {
  const na = normalise(a)
  const nb = normalise(b)
  if (!na || !nb) return null
  if (na === nb) return 'identical'
  // "plank" against "plank 30s" — one is the whole of the other's start.
  if (na.startsWith(`${nb} `) || nb.startsWith(`${na} `)) return 'prefix'
  // Lower than the import threshold: here the user reviews every merge, so a
  // false suggestion costs a glance rather than a wrong write.
  if (similarity(a, b) >= 0.55) return 'similar'
  return null
}

/**
 * @param usage exerciseId → number of logged sets, used to pick which entry of
 *              a group survives.
 */
export function findLibraryIssues(
  exercises: Exercise[],
  usage: Map<string, number> = new Map(),
): LibraryIssues {
  // Union-find, so a three-way pile-up collapses into one group.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root && parent.has(root)) root = parent.get(root)!
    return root
  }
  for (const e of exercises) parent.set(e.id, e.id)

  const reasons = new Map<string, MergeReason>()
  const rank: Record<MergeReason, number> = { identical: 3, prefix: 2, similar: 1 }

  for (let i = 0; i < exercises.length; i++) {
    for (let j = i + 1; j < exercises.length; j++) {
      const a = exercises[i]!
      const b = exercises[j]!
      const how = relation(a.name, b.name)
      if (!how) continue
      const ra = find(a.id)
      const rb = find(b.id)
      if (ra !== rb) parent.set(ra, rb)
      const root = find(a.id)
      const existing = reasons.get(root)
      // Report the strongest relation that put the group together.
      if (!existing || rank[how] > rank[existing]) reasons.set(root, how)
    }
  }

  const groups = new Map<string, Exercise[]>()
  for (const e of exercises) {
    const root = find(e.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(e)
  }

  const merges: MergeCandidate[] = []
  const grouped = new Set<string>()

  for (const [root, members] of groups) {
    if (members.length < 2) continue
    // Name quality decides which entry survives, not which holds more history —
    // the sets move either way, so the only lasting effect is the name. Ties
    // fall to history volume, then to age, so the result never depends on the
    // order the library happened to be scanned in.
    const sorted = [...members].sort((a, b) => {
      const junk = Number(looksUnparsed(a.name)) - Number(looksUnparsed(b.name))
      if (junk !== 0) return junk
      const noise = noiseScore(a.name) - noiseScore(b.name)
      if (noise !== 0) return noise
      const used = (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)
      if (used !== 0) return used
      return a.createdAt.localeCompare(b.createdAt)
    })
    const [canonical, ...duplicates] = sorted
    members.forEach((m) => grouped.add(m.id))
    merges.push({
      canonical: canonical!,
      duplicates,
      reason: reasons.get(root) ?? 'similar',
    })
  }

  // Junk names with nothing to merge into can at least be tidied in place.
  const renames: RenameSuggestion[] = []
  for (const e of exercises) {
    if (grouped.has(e.id)) continue
    const suggested = cleanExerciseName(e.name)
    if (suggested && suggested !== e.name) renames.push({ exercise: e, suggested })
  }

  const total = (c: MergeCandidate) =>
    c.duplicates.reduce((n, d) => n + (usage.get(d.id) ?? 0), 0)

  return {
    // Most history at stake first.
    merges: merges.sort((a, b) => total(b) - total(a)),
    renames,
  }
}
