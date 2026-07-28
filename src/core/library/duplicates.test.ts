import { beforeEach, describe, expect, it } from 'vitest'
import { addSet, createExercise, setSetStatus, startSession, updateSet } from '../../db/queries'
import { db, type Exercise } from '../../db/schema'
import { mergeExercises } from '../../db/queries'
import { findLibraryIssues, looksUnparsed } from './duplicates'

let n = 0
const ex = (name: string, over: Partial<Exercise> = {}): Exercise => ({
  id: `e${++n}`,
  name,
  nameLower: name.toLowerCase(),
  aliases: [],
  equipment: 'barbell',
  primaryMuscles: [],
  secondaryMuscles: [],
  fields: ['weight', 'reps', 'effort'],
  defaultEffortType: 'rpe',
  isArchived: 0,
  createdAt: '2026-07-01T00:00:00Z',
  ...over,
})

describe('looksUnparsed', () => {
  it('recognises the wreckage of a failed parse', () => {
    expect(looksUnparsed('chest row   x6 @')).toBe(true)
    expect(looksUnparsed('facepull    x15 @')).toBe(true)
    expect(looksUnparsed('Squat x5')).toBe(true)
    expect(looksUnparsed('Deadlift -')).toBe(true)
  })

  it('leaves ordinary names alone', () => {
    for (const name of ['Chest row', 'Face pull', "Farmer's Walk", 'T-Bar Row', 'Plank']) {
      expect(looksUnparsed(name), name).toBe(false)
    }
  })
})

describe('findLibraryIssues', () => {
  it('groups a junk name with the real exercise and keeps the clean one', () => {
    const junk = ex('chest row   x6 @')
    const real = ex('Chest row')
    const { merges } = findLibraryIssues([junk, real])

    expect(merges).toHaveLength(1)
    expect(merges[0]!.canonical.id).toBe(real.id)
    expect(merges[0]!.duplicates.map((d) => d.id)).toEqual([junk.id])
  })

  it('matches on a prefix, so "Plank" absorbs "plank 30s"', () => {
    const { merges } = findLibraryIssues([ex('plank 30s'), ex('Plank')])
    expect(merges).toHaveLength(1)
    expect(merges[0]!.canonical.name).toBe('Plank')
    expect(merges[0]!.reason).toBe('prefix')
  })

  it('collapses a three-way pile-up into one group', () => {
    const a = ex('Chest row')
    const b = ex('chest row')
    const c = ex('chest row   x6 @')
    const { merges } = findLibraryIssues([a, b, c])
    expect(merges).toHaveLength(1)
    expect(merges[0]!.duplicates).toHaveLength(2)
  })

  it('prefers the entry carrying more history when both names are clean', () => {
    const few = ex('Chest row')
    const many = ex('Chest Row')
    const { merges } = findLibraryIssues(
      [few, many],
      new Map([
        [few.id, 2],
        [many.id, 40],
      ]),
    )
    expect(merges[0]!.canonical.id).toBe(many.id)
  })

  it('does not suggest merging genuinely different lifts', () => {
    const { merges } = findLibraryIssues([
      ex('Bench Press'),
      ex('Leg Press'),
      ex('Barbell Row'),
      ex('Face Pull'),
      ex('Deadlift'),
    ])
    expect(merges).toEqual([])
  })

  it('suggests a rename for junk with nothing to merge into', () => {
    const { merges, renames } = findLibraryIssues([ex('facepull    x15 @')])
    expect(merges).toEqual([])
    expect(renames).toHaveLength(1)
    expect(renames[0]!.suggested).toBe('facepull')
  })

  it('is quiet on a tidy library', () => {
    const issues = findLibraryIssues([ex('Squat'), ex('Bench Press'), ex('Deadlift')])
    expect(issues.merges).toEqual([])
    expect(issues.renames).toEqual([])
  })
})

describe('mergeExercises', () => {
  beforeEach(async () => {
    await Promise.all([
      db.exercises.clear(),
      db.setEntries.clear(),
      db.sessions.clear(),
      db.routineItems.clear(),
      db.routineDays.clear(),
      db.routines.clear(),
    ])
  })

  it('moves logged sets onto the survivor and records the old name', async () => {
    const real = await createExercise({ name: 'Chest row', equipment: 'machine' })
    const junk = await createExercise({ name: 'chest row   x6 @', equipment: 'barbell' })

    const session = await startSession()
    for (const [exercise, weight] of [
      [real, 20],
      [junk, 25],
      [junk, 30],
    ] as const) {
      const set = await addSet(session.id, exercise)
      await updateSet(set.id, { weightKg: weight, reps: 8 })
      await setSetStatus(set.id, 'completed')
    }

    const moved = await mergeExercises(junk.id, real.id)

    expect(moved).toBe(2)
    expect(await db.exercises.count()).toBe(1)
    const sets = await db.setEntries.toArray()
    expect(sets).toHaveLength(3)
    expect(sets.every((s) => s.exerciseId === real.id)).toBe(true)
    // The denormalised name has to follow, or history renders under two names.
    expect(sets.every((s) => s.exerciseName === 'Chest row')).toBe(true)

    const survivor = (await db.exercises.get(real.id))!
    expect(survivor.aliases).toContain('chest row   x6 @')
  })

  it('repoints routine slots so the duplicate cannot come back', async () => {
    const real = await createExercise({ name: 'Face pull' })
    const junk = await createExercise({ name: 'facepull    x15 @' })

    await db.routines.add({ id: 'r1', name: 'R', source: 'text', createdAt: '2026-07-01' })
    await db.routineDays.add({ id: 'd1', routineId: 'r1', order: 0, name: 'Day A' })
    await db.routineItems.add({
      id: 'i1',
      routineDayId: 'd1',
      order: 0,
      exerciseId: junk.id,
      plannedSets: 2,
    })

    await mergeExercises(junk.id, real.id)

    expect((await db.routineItems.get('i1'))!.exerciseId).toBe(real.id)
  })

  it('refuses to merge an exercise into itself', async () => {
    const only = await createExercise({ name: 'Squat' })
    expect(await mergeExercises(only.id, only.id)).toBe(0)
    expect(await db.exercises.count()).toBe(1)
  })
})
