import { beforeEach, describe, expect, it } from 'vitest'
import { createExercise } from '../../db/queries'
import { db } from '../../db/schema'
import { commitRoutine, resolveNames, type Decision } from './apply'
import { parseRoutineText } from './parseRoutineText'

/**
 * The regression this file exists for: pasting a plain-text log created
 * exercises named `chest row   x6 @` and `facepull    x15 @`, permanently, and
 * split real chest row history across two entries that would never reconcile.
 */

const PASTED = `chest row   x6 @
facepull    x15 @`

beforeEach(async () => {
  await Promise.all([
    db.exercises.clear(),
    db.routines.clear(),
    db.routineDays.clear(),
    db.routineItems.clear(),
    db.setEntries.clear(),
  ])
})

describe('unreadable lines', () => {
  it('flags lines with no scheme and no library match', async () => {
    const parsed = parseRoutineText(PASTED)
    const resolved = await resolveNames(parsed)

    expect(resolved.map((r) => r.name).sort()).toEqual(['chest row', 'facepull'])
    expect(resolved.every((r) => r.unreadable)).toBe(true)
  })

  it('creates nothing when they are left skipped', async () => {
    const parsed = parseRoutineText(PASTED)
    const resolved = await resolveNames(parsed)
    const decisions = new Map<string, Decision>(
      resolved.map((r) => [r.name, { action: 'skip' } as Decision]),
    )

    const result = await commitRoutine(parsed, resolved, decisions)

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(2)
    expect(await db.exercises.count()).toBe(0)
    // The routine is still created, just empty of unreadable slots.
    expect(await db.routineItems.count()).toBe(0)
    expect(await db.routines.get(result.routineId)).toBeDefined()
  })

  it('creates nothing even if a decision is somehow missing', async () => {
    const parsed = parseRoutineText(PASTED)
    const resolved = await resolveNames(parsed)

    // No decisions at all — the old code path would have created both.
    const result = await commitRoutine(parsed, resolved, new Map())

    expect(result.created).toBe(0)
    expect(await db.exercises.count()).toBe(0)
  })

  it('creates the corrected exercise when one is typed', async () => {
    const parsed = parseRoutineText(PASTED)
    const resolved = await resolveNames(parsed)
    const decisions = new Map<string, Decision>([
      ['chest row', { action: 'rename', name: 'Chest-supported row', equipment: 'machine' }],
      ['facepull', { action: 'skip' }],
    ])

    const result = await commitRoutine(parsed, resolved, decisions)

    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    const made = await db.exercises.toArray()
    expect(made.map((e) => e.name)).toEqual(['Chest-supported row'])
    expect(made[0]!.equipment).toBe('machine')
  })

  it('links a corrected name to an exercise that already exists', async () => {
    const existing = await createExercise({ name: 'Face pull', equipment: 'cable' })
    const parsed = parseRoutineText(PASTED)
    const resolved = await resolveNames(parsed)

    const result = await commitRoutine(
      parsed,
      resolved,
      new Map<string, Decision>([
        ['facepull', { action: 'rename', name: 'Face pull', equipment: 'cable' }],
        ['chest row', { action: 'skip' }],
      ]),
    )

    expect(result.created).toBe(0)
    expect(result.linked).toBe(1)
    expect(await db.exercises.count()).toBe(1)
    const items = await db.routineItems.toArray()
    expect(items.map((i) => i.exerciseId)).toEqual([existing.id])
  })
})

describe('normalisation reconnects history', () => {
  it('matches a junk line to the real exercise once cleaned', async () => {
    // This is the whole point: with the trailing "x6 @" stripped, the line is
    // no longer unreadable at all — it resolves to the entry she already has.
    const chestRow = await createExercise({ name: 'Chest row', equipment: 'machine' })

    const parsed = parseRoutineText('chest row   x6 @')
    const resolved = await resolveNames(parsed)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.unreadable).toBe(false)
    expect(resolved[0]!.existing?.id).toBe(chestRow.id)

    const result = await commitRoutine(parsed, resolved, new Map())
    expect(result.linked).toBe(1)
    expect(result.created).toBe(0)
    expect(await db.exercises.count()).toBe(1)
  })
})
