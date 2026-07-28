import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { TrainingDb } from './schema'

/**
 * The v1 → v2 upgrade runs on a real device holding real training history, so
 * it is worth exercising rather than assuming. v1 had no `status`: a set was
 * either ticked or it was deleted at session finish.
 */

const V1_STORES = {
  exercises: 'id, nameLower, *aliases, isArchived, equipment',
  routines: 'id, name, createdAt',
  routineDays: 'id, routineId, [routineId+order]',
  routineItems: 'id, routineDayId, [routineDayId+order]',
  sessions: 'id, date, startedAt, isComplete, routineDayId',
  setEntries: 'id, sessionId, exerciseId, [sessionId+order], [exerciseId+date]',
  settings: 'id',
}

const v1Set = (id: string, isComplete: 0 | 1) => ({
  id,
  sessionId: 's1',
  exerciseId: 'e1',
  exerciseName: 'Barbell Back Squat',
  date: '2026-07-28',
  order: 0,
  setNumber: Number(id.slice(1)),
  setType: 'working',
  weightKg: 140,
  reps: 5,
  isComplete,
})

describe('v1 to v2 migration', () => {
  it('gives every existing set a status without touching anything else', async () => {
    const name = `migration-${Math.random().toString(36).slice(2)}`

    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    await old.open()
    await old.table('setEntries').bulkAdd([v1Set('n1', 1), v1Set('n2', 1), v1Set('n3', 0)])
    old.close()

    // Opening through the current schema triggers the upgrade.
    const upgraded = new TrainingDb(name)
    const rows = (await upgraded.setEntries.toArray()).sort((a, b) => a.id.localeCompare(b.id))

    expect(rows.map((r) => r.status)).toEqual(['completed', 'completed', 'planned'])
    // isComplete must stay in step, since queries still filter on it.
    expect(rows.map((r) => r.isComplete)).toEqual([1, 1, 0])
    // Nothing else may be disturbed by the upgrade.
    expect(rows.map((r) => r.weightKg)).toEqual([140, 140, 140])
    expect(rows.map((r) => r.exerciseName)).toEqual([
      'Barbell Back Squat',
      'Barbell Back Squat',
      'Barbell Back Squat',
    ])
    expect(await upgraded.setEntries.count()).toBe(3)

    upgraded.close()
  })

  it('gives existing routines a version without inventing prescriptions', async () => {
    const name = `migration-v3-${Math.random().toString(36).slice(2)}`

    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    old.version(2) // status was a field change only, no store change
    await old.open()
    await old.table('routines').add({
      id: 'r1',
      name: 'Block 1',
      source: 'text',
      createdAt: '2026-07-01T00:00:00Z',
    })
    await old.table('setEntries').add({ ...v1Set('n1', 1), status: 'completed' })
    old.close()

    const upgraded = new TrainingDb(name)
    const routine = (await upgraded.routines.get('r1'))!
    expect(routine.version).toBe(1)
    expect(routine.supersededBy).toBeUndefined()

    // Sessions already logged have no prescription to recover, and guessing one
    // would be worse than leaving it blank.
    const set = (await upgraded.setEntries.get('n1'))!
    expect(set.plannedSets).toBeUndefined()
    expect(set.plannedRepsMin).toBeUndefined()
    expect(set.status).toBe('completed')
    expect(set.weightKg).toBe(140)

    upgraded.close()
  })

  it('leaves an empty v1 database usable', async () => {
    const name = `migration-empty-${Math.random().toString(36).slice(2)}`
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    await old.open()
    old.close()

    const upgraded = new TrainingDb(name)
    expect(await upgraded.setEntries.count()).toBe(0)
    upgraded.close()
  })
})
