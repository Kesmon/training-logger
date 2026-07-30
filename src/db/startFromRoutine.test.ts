import { beforeEach, describe, expect, it } from 'vitest'
import { commitRoutine, resolveNames } from '../core/import/apply'
import { parseRoutineText } from '../core/import/parseRoutineText'
import { startSessionFromRoutineDay } from './queries'
import { db } from './schema'

/**
 * Starting a session from a routine used to be duplicated across two screens,
 * and they drifted: one of them seeded no sets at all, and snapshotted neither
 * the routine version nor the day note, because two later changes were applied
 * to only one copy. Everything that path is supposed to do is pinned here.
 */

const ROUTINE = `# Block 2

## S1 — Lower
> If you're still sore, cut the RDLs.
- Barbell Back Squat 3x8-10 — 3 RIR
- Bulgarian Split Squat 2x10 per leg
- Plank 3x30s`

async function importRoutine() {
  const parsed = parseRoutineText(ROUTINE)
  const { routineId } = await commitRoutine(parsed, await resolveNames(parsed), new Map())
  const day = (await db.routineDays.where('routineId').equals(routineId).toArray())[0]!
  return { routineId, day }
}

beforeEach(async () => {
  await Promise.all([
    db.exercises.clear(),
    db.routines.clear(),
    db.routineDays.clear(),
    db.routineItems.clear(),
    db.sessions.clear(),
    db.setEntries.clear(),
  ])
})

describe('startSessionFromRoutineDay', () => {
  it('lays out a blank row for every prescribed set', async () => {
    const { day } = await importRoutine()
    const session = (await startSessionFromRoutineDay(day.id))!

    const sets = await db.setEntries.where('sessionId').equals(session.id).toArray()
    // 3 squat + 2 split squat + 3 plank. The bug produced zero.
    expect(sets).toHaveLength(8)
    expect(new Set(sets.map((s) => s.exerciseName))).toEqual(
      new Set(['Barbell Back Squat', 'Bulgarian Split Squat', 'Plank']),
    )
    expect(sets.every((s) => s.status === 'planned')).toBe(true)
  })

  it('snapshots the routine identity, including the version', async () => {
    const { routineId, day } = await importRoutine()
    const session = (await startSessionFromRoutineDay(day.id))!

    expect(session.routineId).toBe(routineId)
    expect(session.routineName).toBe('Block 2')
    // Silently missing before, which left routine_version blank in the export.
    expect(session.routineVersion).toBe(1)
    expect(session.dayName).toBe('S1 — Lower')
  })

  it('carries the day note through to the session', async () => {
    const { day } = await importRoutine()
    const session = (await startSessionFromRoutineDay(day.id))!
    expect(session.dayNote).toBe("If you're still sore, cut the RDLs.")
  })

  it('carries each exercise’s prescription onto its sets', async () => {
    const { day } = await importRoutine()
    const session = (await startSessionFromRoutineDay(day.id))!
    const sets = await db.setEntries.where('sessionId').equals(session.id).toArray()

    const squat = sets.find((s) => s.exerciseName === 'Barbell Back Squat')!
    expect(squat).toMatchObject({ plannedSets: 3, plannedRepsMin: 8, plannedRepsMax: 10 })

    const split = sets.find((s) => s.exerciseName === 'Bulgarian Split Squat')!
    expect(split).toMatchObject({ plannedSets: 2, plannedRepsMin: 10, perSide: true })

    const plank = sets.find((s) => s.exerciseName === 'Plank')!
    expect(plank).toMatchObject({ plannedSets: 3, plannedDurationSec: 30 })
  })

  it('picks up the current version after a re-import', async () => {
    await importRoutine()
    // Same name again — a new version supersedes the first.
    const { day } = await importRoutine()

    const session = (await startSessionFromRoutineDay(day.id))!
    expect(session.routineVersion).toBe(2)
  })

  it('returns undefined for a day that no longer exists', async () => {
    expect(await startSessionFromRoutineDay('gone')).toBeUndefined()
    expect(await db.sessions.count()).toBe(0)
  })
})
