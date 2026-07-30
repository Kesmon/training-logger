import { nowIso } from '../core/ids'
import { commitRoutine, resolveNames, type Decision } from '../core/import/apply'
import { classifyUpdate, type Holdback } from '../core/import/classify'
import { diffRoutines, snapshotOfParsed, type RoutineChange } from '../core/import/diffRoutines'
import { hashSource } from '../core/import/hash'
import { parseRoutineCsv } from '../core/import/parseRoutineCsv'
import { parseRoutineText } from '../core/import/parseRoutineText'
import {
  getActiveSession,
  listRoutineSources,
  snapshotOfRoutine,
  updateRoutineSource,
} from '../db/queries'
import type { RoutineSource } from '../db/schema'
import { fetchSource, SourceError, type FetchedSource } from '../platform/fetchSource'

/**
 * Keeping a subscribed routine in step with the sheet the coach edits.
 *
 * This module sits above `core/`, `db/` and `platform/` because it is the one
 * thing that needs all three — it fetches, parses, compares and writes. Putting
 * it in `core/` would have dragged a network dependency into the layer whose
 * whole value is being pure and testable without one.
 *
 * Three gates stand between a fetched file and a written routine version:
 *
 *   1. the content hash — did the bytes move at all
 *   2. the diff        — did the *routine* move, or just a trailing blank row
 *   3. the classifier  — is every exercise one we already know
 *
 * Only something that clears all three applies unattended. Anything else is
 * kept as pending and surfaced, because the alternative is guessing, and
 * guessing at a routine is how junk gets into the library permanently.
 */

/** At most one automatic check per source in this window. */
const MIN_INTERVAL_MS = 5 * 60 * 1000

export type UpdateOutcome =
  /** Checked too recently; nothing was fetched. */
  | { kind: 'rate-limited' }
  /** The sheet is byte-identical to the last look. */
  | { kind: 'unchanged' }
  /** The bytes moved but the routine did not — a republish, not an edit. */
  | { kind: 'cosmetic' }
  /** A real change, withheld because a session is in progress. */
  | { kind: 'deferred'; changes: RoutineChange[] }
  /** A real change, withheld for review. */
  | { kind: 'held'; changes: RoutineChange[]; holdback: Holdback[] }
  /** Applied. `holdback` lists what was left out of an otherwise-applied update. */
  | { kind: 'applied'; routineId: string; version: number; changes: RoutineChange[]; holdback: Holdback[] }
  | { kind: 'failed'; message: string }

export interface SyncDeps {
  /** Injected in tests so nothing touches the network. */
  fetch?: (url: string) => Promise<FetchedSource>
  /** A manual "Check now" ignores the rate limit. */
  force?: boolean
}

const parseFor = (format: 'csv' | 'text', raw: string, fallback: string) =>
  format === 'csv' ? parseRoutineCsv(raw, fallback) : parseRoutineText(raw, fallback)

/**
 * Fetches, and applies if the result clears all three gates.
 *
 * Never throws: a failure is an outcome, because this runs unattended on app
 * launch and must not be able to take the screen down with it.
 */
export async function checkRoutineSource(
  source: RoutineSource,
  deps: SyncDeps = {},
): Promise<UpdateOutcome> {
  if (!deps.force && source.lastCheckedAt) {
    const since = Date.now() - new Date(source.lastCheckedAt).getTime()
    if (since >= 0 && since < MIN_INTERVAL_MS) return { kind: 'rate-limited' }
  }

  let fetched: FetchedSource
  try {
    fetched = await (deps.fetch ? deps.fetch(source.url) : fetchSource(source.url))
  } catch (err) {
    const message = err instanceof SourceError ? err.message : 'Could not reach the link.'
    await updateRoutineSource(source.id, { lastCheckedAt: nowIso(), lastError: message })
    return { kind: 'failed', message }
  }

  const hash = hashSource(fetched.text)
  if (hash === source.lastHash) {
    await updateRoutineSource(source.id, { lastCheckedAt: nowIso(), lastError: undefined })
    return { kind: 'unchanged' }
  }

  return applyFetched(source, fetched.text, fetched.format, hash, {})
}

/** Every subscription, in sequence. Failures do not stop the others. */
export async function checkAllRoutineSources(deps: SyncDeps = {}): Promise<UpdateOutcome[]> {
  const sources = await listRoutineSources()
  const out: UpdateOutcome[] = []
  for (const source of sources) out.push(await checkRoutineSource(source, deps))
  return out
}

/**
 * Applies source text already fetched and stored as pending — used when a
 * deferred update is released after a session ends, and when the user accepts
 * an exercise that was held back.
 *
 * `extraDecisions` overrides the automatic skips, so accepting one new lift
 * does not also accept the others that were held back alongside it.
 */
export async function applyPendingSource(
  source: RoutineSource,
  extraDecisions: Map<string, Decision> = new Map(),
): Promise<UpdateOutcome> {
  if (!source.pendingRaw || !source.pendingHash) return { kind: 'unchanged' }

  // The pending text was sniffed when it was fetched; the source's own format
  // is the best record of it.
  return applyFetched(source, source.pendingRaw, source.format, source.pendingHash, {
    extraDecisions,
    manual: true,
  })
}

async function applyFetched(
  source: RoutineSource,
  raw: string,
  format: 'csv' | 'text',
  hash: string,
  opts: { extraDecisions?: Map<string, Decision>; manual?: boolean },
): Promise<UpdateOutcome> {
  let parsed
  try {
    parsed = parseFor(format, raw, 'Imported routine')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read that file.'
    await updateRoutineSource(source.id, { lastCheckedAt: nowIso(), lastError: message })
    return { kind: 'failed', message }
  }

  const resolutions = await resolveNames(parsed)
  const classified = classifyUpdate(resolutions)

  // Anything the user explicitly decided wins over the automatic skip.
  const decisions = new Map(classified.decisions)
  for (const [name, decision] of opts.extraDecisions ?? []) decisions.set(name, decision)
  const holdback = classified.holdback.filter((h) => !opts.extraDecisions?.has(h.name))

  const changes = diffRoutines(await snapshotOfRoutine(source.routineId), snapshotOfParsed(parsed))

  // Gate two. A trailing blank row in a spreadsheet moves the bytes without
  // touching the programme, and cutting a routine version for that would fill
  // the history with revisions nobody made.
  if (changes.length === 0 && !opts.extraDecisions?.size) {
    await updateRoutineSource(source.id, {
      lastHash: hash,
      lastCheckedAt: nowIso(),
      lastError: undefined,
    })
    return { kind: 'cosmetic' }
  }

  const holdPending = async () => {
    await updateRoutineSource(source.id, {
      lastCheckedAt: nowIso(),
      lastError: undefined,
      pendingRaw: raw,
      pendingHash: hash,
      pendingNames: holdback.map((h) => h.name),
    })
  }

  // An automatic update never disturbs a session in progress — the same reason
  // the service worker prompts rather than reloading. `lastHash` is left alone
  // so the next check after training still sees this as new.
  if (!opts.manual && (await getActiveSession())) {
    await holdPending()
    return { kind: 'deferred', changes }
  }

  if (!opts.manual && !source.autoApply) {
    await holdPending()
    return { kind: 'held', changes, holdback }
  }

  const { routineId, version } = await commitRoutine(parsed, resolutions, decisions, raw, {
    supersedes: source.routineId,
  })

  await updateRoutineSource(source.id, {
    routineId,
    lastHash: hash,
    lastCheckedAt: nowIso(),
    lastAppliedAt: nowIso(),
    lastError: undefined,
    // The raw text is kept while anything is still held back, so accepting a
    // new lift later can re-commit from exactly the file it came from.
    pendingRaw: holdback.length > 0 ? raw : undefined,
    pendingHash: holdback.length > 0 ? hash : undefined,
    pendingNames: holdback.length > 0 ? holdback.map((h) => h.name) : undefined,
  })

  return { kind: 'applied', routineId, version, changes, holdback }
}
