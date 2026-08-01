import { beforeEach, describe, expect, it } from 'vitest'
import { addSet, createExercise, saveSettings, setSetStatus, startSession, updateSet } from './queries'
import { db } from './schema'

/**
 * The global effort scale has to stay authoritative.
 *
 * It did not: `createExercise` copied `settings.defaultEffortType` onto every
 * exercise, and because an exercise sits earlier than the setting in the chain
 * `SetRow` resolves through, switching Settings to RIR changed nothing for any
 * lift already in the library. The stale value was then written onto each new
 * set, so the wrong scale was recorded rather than merely displayed.
 */

async function wipe() {
  await Promise.all([
    db.exercises.clear(),
    db.sessions.clear(),
    db.setEntries.clear(),
    db.settings.clear(),
  ])
}

beforeEach(async () => {
  await wipe()
})

describe('effort scale follows the setting', () => {
  it('does not stamp a scale onto a new exercise', async () => {
    const squat = await createExercise({ name: 'Barbell Back Squat' })

    // Null is "follow the global", which is the whole point.
    expect(squat.defaultEffortType).toBeNull()
  })

  it('does not stamp a scale onto a new set', async () => {
    const squat = await createExercise({ name: 'Barbell Back Squat' })
    const session = await startSession()

    const set = await addSet(session.id, squat)

    expect(set.effortType).toBeUndefined()
  })

  it('is unaffected by which scale was set when the exercise was created', async () => {
    // Created under the shipped default...
    await saveSettings({ defaultEffortType: 'rpe' })
    const squat = await createExercise({ name: 'Barbell Back Squat' })

    // ...then the user switches. This is exactly the reported bug.
    await saveSettings({ defaultEffortType: 'rir' })

    const stored = (await db.exercises.get(squat.id))!
    expect(stored.defaultEffortType).toBeNull()

    const session = await startSession()
    const set = await addSet(session.id, stored)
    // Nothing on the set or the exercise can shadow the setting any more.
    expect(set.effortType).toBeUndefined()
  })

  it('carries the scale from the previous set once one has been chosen', async () => {
    const squat = await createExercise({ name: 'Barbell Back Squat' })
    const session = await startSession()

    const first = await addSet(session.id, squat)
    // Rating a set records the scale it was rated on — that much must persist.
    await updateSet(first.id, { effortType: 'rir', effortValue: 2 })

    const second = await addSet(session.id, (await db.exercises.get(squat.id))!)

    expect(second.effortType).toBe('rir')
    // The value itself is still deliberately not carried: it is the thing that
    // actually changes set to set.
    expect(second.effortValue).toBeUndefined()
  })

  it('keeps the scale a logged set was actually rated on', async () => {
    const squat = await createExercise({ name: 'Barbell Back Squat' })
    const session = await startSession()
    const set = await addSet(session.id, squat)

    await updateSet(set.id, { weightKg: 140, reps: 5, effortType: 'rpe', effortValue: 8 })
    await setSetStatus(set.id, 'completed')
    await saveSettings({ defaultEffortType: 'rir' })

    // Switching the setting must never relabel history. RPE 8 and RIR 8 are
    // opposite ends of the scale.
    const stored = (await db.setEntries.get(set.id))!
    expect(stored.effortType).toBe('rpe')
    expect(stored.effortValue).toBe(8)
  })
})
