import type { Decision, NameResolution } from './apply'

/**
 * Decides how much of an incoming routine update may be applied without a human
 * reading it.
 *
 * The rule this exists to protect: **an exercise is never created from a line
 * the importer could not read.** Auto-update must not become a back door around
 * the review screen — a typo in a shared sheet would otherwise put junk in the
 * library permanently and split real history in two, which is a bug this
 * project has already fixed once.
 *
 * So the safe set is deliberately narrow: a name only applies unattended when
 * it resolves to an exercise that already exists. Everything else is held back
 * and surfaced, while the rest of the update goes through — a coach adding one
 * new accessory should not block a set-count change to the other six.
 */

export type HoldbackReason =
  /** The line parsed, but names a movement the library has never seen. */
  | 'unknown'
  /** No set scheme recognised *and* no library match — the app has no idea what this is. */
  | 'unreadable'

export interface Holdback {
  name: string
  reason: HoldbackReason
  /** How many times the routine mentions it. */
  uses: number
  /**
   * A close-but-not-exact library entry, when `resolveNames` found one. Offered
   * in the prompt as "did you mean…", never applied automatically — a suggestion
   * is a guess, and acting on a guess is the whole failure mode above.
   */
  suggestion?: NameResolution['suggestion']
}

export interface UpdateClassification {
  /** True when nothing was held back, so the update applies in full. */
  safe: boolean
  holdback: Holdback[]
  /**
   * Ready to hand to `commitRoutine`: every held-back name mapped to `skip`.
   * `commitRoutine` already honours skip decisions and already refuses to
   * create from an unreadable name, so this needs no new commit path.
   */
  decisions: Map<string, Decision>
}

export function classifyUpdate(resolutions: NameResolution[]): UpdateClassification {
  const holdback: Holdback[] = []
  const decisions = new Map<string, Decision>()

  for (const resolution of resolutions) {
    if (resolution.existing && !resolution.unreadable) continue

    holdback.push({
      name: resolution.name,
      reason: resolution.unreadable ? 'unreadable' : 'unknown',
      uses: resolution.uses,
      suggestion: resolution.suggestion,
    })
    decisions.set(resolution.name, { action: 'skip' })
  }

  // Unreadable first, then by how much of the routine is affected — the same
  // ordering the import preview uses, so the two screens read alike.
  holdback.sort(
    (a, b) =>
      Number(b.reason === 'unreadable') - Number(a.reason === 'unreadable') ||
      b.uses - a.uses ||
      a.name.localeCompare(b.name),
  )

  return { safe: holdback.length === 0, holdback, decisions }
}
