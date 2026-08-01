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

/**
 * v4 adds the routineSources table. Because only version(1) declares `.stores()`,
 * v4 has to restate every store — and a restatement that dropped one would take
 * the table's data with it. That is what this exercises: real rows in every
 * table, opened through the new schema, still there afterwards.
 */
describe('v3 to v4 migration', () => {
  const openAtV3 = async (name: string) => {
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    old.version(2)
    old.version(3)
    await old.open()
    return old
  }

  it('adds routineSources without disturbing any existing table', async () => {
    const name = `migration-v4-${Math.random().toString(36).slice(2)}`

    const old = await openAtV3(name)
    await old.table('exercises').add({
      id: 'e1',
      name: 'Barbell Back Squat',
      nameLower: 'barbell back squat',
      aliases: ['squat'],
      equipment: 'barbell',
      primaryMuscles: ['Quads'],
      secondaryMuscles: [],
      fields: ['weight', 'reps', 'effort'],
      defaultEffortType: 'rpe',
      isArchived: 0,
      createdAt: '2026-07-01T00:00:00Z',
    })
    await old.table('routines').add({
      id: 'r1',
      name: 'Block 1',
      version: 1,
      source: 'text',
      createdAt: '2026-07-01T00:00:00Z',
    })
    await old.table('routineDays').add({ id: 'd1', routineId: 'r1', order: 0, name: 'Day A' })
    await old.table('routineItems').add({
      id: 'i1',
      routineDayId: 'd1',
      order: 0,
      exerciseId: 'e1',
      plannedSets: 5,
    })
    await old.table('sessions').add({
      id: 's1',
      date: '2026-07-28',
      startedAt: '2026-07-28T17:00:00Z',
      isComplete: 1,
    })
    await old.table('setEntries').add({ ...v1Set('n1', 1), status: 'completed' })
    await old.table('settings').add({ id: 'settings', unit: 'kg', sessionsSinceExport: 0 })
    old.close()

    const upgraded = new TrainingDb(name)

    // The new table exists and is empty — nothing to backfill.
    expect(await upgraded.routineSources.count()).toBe(0)

    // Every pre-existing table survived the restatement.
    expect((await upgraded.exercises.get('e1'))!.aliases).toEqual(['squat'])
    expect((await upgraded.routines.get('r1'))!.version).toBe(1)
    expect((await upgraded.routineDays.get('d1'))!.name).toBe('Day A')
    expect((await upgraded.routineItems.get('i1'))!.plannedSets).toBe(5)
    expect((await upgraded.sessions.get('s1'))!.isComplete).toBe(1)
    expect((await upgraded.setEntries.get('n1'))!.weightKg).toBe(140)
    expect((await upgraded.settings.get('settings'))!.unit).toBe('kg')

    upgraded.close()
  })

  it('keeps the indexes the restatement had to repeat', async () => {
    const name = `migration-v4-idx-${Math.random().toString(36).slice(2)}`
    const old = await openAtV3(name)
    await old.table('setEntries').add({ ...v1Set('n1', 1), status: 'completed' })
    old.close()

    const upgraded = new TrainingDb(name)

    // A dropped index would not lose data, but every `where` in the app would
    // start throwing — so the compound ones are worth an explicit check.
    expect(await upgraded.setEntries.where('[exerciseId+date]').equals(['e1', '2026-07-28']).count()).toBe(1)
    expect(await upgraded.setEntries.where('sessionId').equals('s1').count()).toBe(1)
    expect(await upgraded.exercises.where('nameLower').equals('nothing').count()).toBe(0)

    upgraded.close()
  })

  it('releases the effort scale frozen onto existing exercises', async () => {
    const name = `migration-v5-${Math.random().toString(36).slice(2)}`

    const old = await openAtV3(name)
    await old.table('exercises').add({
      id: 'e1',
      name: 'Barbell Back Squat',
      nameLower: 'barbell back squat',
      aliases: [],
      equipment: 'barbell',
      primaryMuscles: [],
      secondaryMuscles: [],
      fields: ['weight', 'reps', 'effort'],
      // Whatever the global default happened to be on the day it was created.
      defaultEffortType: 'rpe',
      isArchived: 0,
      createdAt: '2026-07-01T00:00:00Z',
    })
    // A set that was rated, and one that was only ever laid out.
    await old.table('setEntries').add({
      ...v1Set('n1', 1),
      status: 'completed',
      effortType: 'rpe',
      effortValue: 8,
    })
    await old.table('setEntries').add({
      ...v1Set('n2', 0),
      status: 'planned',
      effortType: 'rpe',
    })
    old.close()

    const upgraded = new TrainingDb(name)

    // The exercise now follows the global setting again.
    expect((await upgraded.exercises.get('e1'))!.defaultEffortType).toBeNull()

    // The unrated row is released, so an open session picks up the setting.
    expect((await upgraded.setEntries.get('n2'))!.effortType).toBeUndefined()

    // The rated one is untouched. Relabelling it would turn an RPE 8 into a
    // RIR 8 — the opposite end of the scale — in both the app and the coach's
    // CSV. It really was logged as RPE.
    const logged = (await upgraded.setEntries.get('n1'))!
    expect(logged.effortType).toBe('rpe')
    expect(logged.effortValue).toBe(8)

    upgraded.close()
  })

  it('can store and find a subscription by the routine it feeds', async () => {
    const name = `migration-v4-src-${Math.random().toString(36).slice(2)}`
    const old = await openAtV3(name)
    old.close()

    const upgraded = new TrainingDb(name)
    await upgraded.routineSources.add({
      id: 'src1',
      url: 'https://example.invalid/pub?output=csv',
      routineId: 'r1',
      format: 'csv',
      autoApply: 1,
    })

    expect((await upgraded.routineSources.where('routineId').equals('r1').first())!.id).toBe('src1')
    upgraded.close()
  })
})
