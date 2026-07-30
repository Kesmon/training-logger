import { beforeEach, describe, expect, it } from 'vitest'
import { hashSource } from '../core/import/hash'
import { commitRoutine, resolveNames } from '../core/import/apply'
import { parseRoutineText } from '../core/import/parseRoutineText'
import { createExercise, createRoutineSource, startSession } from '../db/queries'
import { db, type RoutineSource } from '../db/schema'
import { SourceError, type FetchedSource } from '../platform/fetchSource'
import { applyPendingSource, checkRoutineSource } from './updateRoutine'

const URL = 'https://example.invalid/pub?output=csv'

const BLOCK_1 = `# Block 2
## Day A
- Barbell Back Squat 5x5
- Bench Press 3x8`

/** The same routine with one set count changed — the common coach edit. */
const BLOCK_2 = `# Block 2
## Day A
- Barbell Back Squat 4x5
- Bench Press 3x8`

async function wipe() {
  await Promise.all([
    db.exercises.clear(),
    db.routines.clear(),
    db.routineDays.clear(),
    db.routineItems.clear(),
    db.sessions.clear(),
    db.setEntries.clear(),
    db.routineSources.clear(),
  ])
}

/** A subscribed routine already imported once, exactly as the app would leave it. */
async function subscribe(text = BLOCK_1): Promise<RoutineSource> {
  await createExercise({ name: 'Barbell Back Squat' })
  await createExercise({ name: 'Bench Press' })

  const parsed = parseRoutineText(text)
  const resolutions = await resolveNames(parsed)
  const { routineId } = await commitRoutine(parsed, resolutions, new Map(), text)

  return createRoutineSource({ url: URL, routineId, format: 'text', lastHash: hashSource(text) })
}

/** A fetcher that always answers with the given text, and never a network. */
const serving = (text: string) => async (): Promise<FetchedSource> => ({ text, format: 'text' })

const failing = (message: string) => async (): Promise<FetchedSource> => {
  throw new SourceError(message)
}

beforeEach(async () => {
  await wipe()
})

describe('checkRoutineSource', () => {
  it('writes nothing when the sheet has not changed', async () => {
    const source = await subscribe()
    const before = await db.routines.count()

    const outcome = await checkRoutineSource(source, { fetch: serving(BLOCK_1), force: true })

    expect(outcome.kind).toBe('unchanged')
    expect(await db.routines.count()).toBe(before)
  })

  it('cuts a new version and supersedes the old one on a real edit', async () => {
    const source = await subscribe()

    const outcome = await checkRoutineSource(source, { fetch: serving(BLOCK_2), force: true })

    expect(outcome).toMatchObject({ kind: 'applied', version: 2 })
    if (outcome.kind !== 'applied') throw new Error('expected applied')

    expect(outcome.changes).toEqual([
      { kind: 'sets-changed', day: 'Day A', exercise: 'Barbell Back Squat', from: 5, to: 4 },
    ])

    // The old routine is kept so logged sessions still resolve, but superseded.
    const old = (await db.routines.get(source.routineId))!
    expect(old.supersededBy).toBe(outcome.routineId)

    // The subscription now feeds the new routine.
    const updated = (await db.routineSources.get(source.id))!
    expect(updated.routineId).toBe(outcome.routineId)
    expect(updated.lastHash).toBe(hashSource(BLOCK_2))
  })

  it('does not cut a version when only the bytes moved', async () => {
    const source = await subscribe()
    const before = await db.routines.count()

    // A blank line inserted inside the file: the parser skips it, so the bytes
    // differ and the hash gate opens, but the routine is identical. This is the
    // second gate — without it a spreadsheet gaining a spare row would cut a
    // version nobody asked for.
    const spaced = BLOCK_1.replace('## Day A\n', '## Day A\n\n')
    expect(hashSource(spaced)).not.toBe(hashSource(BLOCK_1))

    const outcome = await checkRoutineSource(source, { fetch: serving(spaced), force: true })

    expect(outcome.kind).toBe('cosmetic')
    expect(await db.routines.count()).toBe(before)
    // The new hash is still recorded, so the same republish is not re-examined.
    expect((await db.routineSources.get(source.id))!.lastHash).toBe(hashSource(spaced))
  })

  it('applies the recognised part and holds back a lift it has never seen', async () => {
    const source = await subscribe()

    const outcome = await checkRoutineSource(source, {
      fetch: serving(`${BLOCK_2}\n- Copenhagen Plank 3x30s`),
      force: true,
    })

    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') throw new Error('expected applied')

    // The set-count change went through...
    expect(outcome.changes).toContainEqual(
      expect.objectContaining({ kind: 'sets-changed', from: 5, to: 4 }),
    )
    // ...and the unknown lift did not enter the library.
    expect(outcome.holdback.map((h) => h.name)).toEqual(['Copenhagen Plank'])
    expect(await db.exercises.where('nameLower').equals('copenhagen plank').count()).toBe(0)

    // It is kept as pending so it can be offered later.
    const updated = (await db.routineSources.get(source.id))!
    expect(updated.pendingNames).toEqual(['Copenhagen Plank'])
    expect(updated.pendingRaw).toContain('Copenhagen Plank')
  })

  it('never applies while a session is in progress', async () => {
    const source = await subscribe()
    await startSession()
    const before = await db.routines.count()

    const outcome = await checkRoutineSource(source, { fetch: serving(BLOCK_2), force: true })

    expect(outcome.kind).toBe('deferred')
    expect(await db.routines.count()).toBe(before)

    // lastHash is deliberately untouched, so the next check after training
    // still sees this as new rather than skipping it as already seen.
    const updated = (await db.routineSources.get(source.id))!
    expect(updated.lastHash).toBe(hashSource(BLOCK_1))
    expect(updated.pendingHash).toBe(hashSource(BLOCK_2))
  })

  it('applies the deferred update once the session is over', async () => {
    const source = await subscribe()
    const session = await startSession()
    await checkRoutineSource(source, { fetch: serving(BLOCK_2), force: true })

    await db.sessions.update(session.id, { isComplete: 1 })
    const pending = (await db.routineSources.get(source.id))!

    const outcome = await checkRoutineSource(pending, { fetch: serving(BLOCK_2), force: true })

    expect(outcome).toMatchObject({ kind: 'applied', version: 2 })
  })

  it('holds everything for review when auto-apply is off', async () => {
    const source = await subscribe()
    await db.routineSources.update(source.id, { autoApply: 0 })
    const off = (await db.routineSources.get(source.id))!

    const outcome = await checkRoutineSource(off, { fetch: serving(BLOCK_2), force: true })

    expect(outcome.kind).toBe('held')
    expect(await db.routines.count()).toBe(1)
  })

  it('records a failure without throwing, and leaves the routine alone', async () => {
    const source = await subscribe()

    const outcome = await checkRoutineSource(source, {
      fetch: failing('Could not reach the link.'),
      force: true,
    })

    expect(outcome).toEqual({ kind: 'failed', message: 'Could not reach the link.' })
    expect(await db.routines.count()).toBe(1)
    expect((await db.routineSources.get(source.id))!.lastError).toBe('Could not reach the link.')
  })

  it('clears a stale error once the link works again', async () => {
    const source = await subscribe()
    await checkRoutineSource(source, { fetch: failing('offline'), force: true })

    const afterFailure = (await db.routineSources.get(source.id))!
    await checkRoutineSource(afterFailure, { fetch: serving(BLOCK_1), force: true })

    expect((await db.routineSources.get(source.id))!.lastError).toBeUndefined()
  })

  it('does not fetch again within the rate-limit window', async () => {
    const source = await subscribe()
    let calls = 0
    const counting = async (): Promise<FetchedSource> => {
      calls++
      return { text: BLOCK_2, format: 'text' }
    }

    const outcome = await checkRoutineSource(source, { fetch: counting })

    expect(outcome.kind).toBe('rate-limited')
    expect(calls).toBe(0)
  })

  it('survives the routine it feeds having been deleted', async () => {
    const source = await subscribe()
    await db.routines.clear()
    await db.routineDays.clear()
    await db.routineItems.clear()

    const outcome = await checkRoutineSource(source, { fetch: serving(BLOCK_2), force: true })

    // Everything reads as added, which is truthful, and it re-establishes the
    // lineage rather than throwing.
    expect(outcome.kind).toBe('applied')
  })
})

describe('applyPendingSource', () => {
  it('adds a held-back lift when the user accepts it', async () => {
    const source = await subscribe()
    await checkRoutineSource(source, {
      fetch: serving(`${BLOCK_1}\n- Copenhagen Plank 3x30s`),
      force: true,
    })

    const pending = (await db.routineSources.get(source.id))!
    const outcome = await applyPendingSource(
      pending,
      new Map([['Copenhagen Plank', { action: 'create', equipment: 'bodyweight' }]]),
    )

    expect(outcome.kind).toBe('applied')
    expect(await db.exercises.where('nameLower').equals('copenhagen plank').count()).toBe(1)

    // Nothing is left outstanding.
    const settled = (await db.routineSources.get(source.id))!
    expect(settled.pendingNames).toBeUndefined()
    expect(settled.pendingRaw).toBeUndefined()
  })

  it('accepts one held-back lift without accepting the others', async () => {
    const source = await subscribe()
    await checkRoutineSource(source, {
      fetch: serving(`${BLOCK_1}\n- Copenhagen Plank 3x30s\n- Hip Airplane 2x8`),
      force: true,
    })

    const pending = (await db.routineSources.get(source.id))!
    await applyPendingSource(
      pending,
      new Map([['Copenhagen Plank', { action: 'create', equipment: 'bodyweight' }]]),
    )

    expect(await db.exercises.where('nameLower').equals('copenhagen plank').count()).toBe(1)
    expect(await db.exercises.where('nameLower').equals('hip airplane').count()).toBe(0)
    expect((await db.routineSources.get(source.id))!.pendingNames).toEqual(['Hip Airplane'])
  })

  it('does nothing when there is no pending source', async () => {
    const source = await subscribe()
    expect((await applyPendingSource(source)).kind).toBe('unchanged')
  })
})
