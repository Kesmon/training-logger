import { describe, expect, it } from 'vitest'
import type { NameResolution } from './apply'
import { classifyUpdate } from './classify'
import type { Exercise } from '../../db/schema'

const exercise = (name: string): Exercise => ({
  id: `ex-${name}`,
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
})

const known = (name: string): NameResolution => ({
  name,
  existing: exercise(name),
  uses: 1,
  timed: false,
  unilateral: false,
  unreadable: false,
})

const unknown = (name: string, uses = 1): NameResolution => ({
  name,
  uses,
  timed: false,
  unilateral: false,
  unreadable: false,
})

const unreadable = (name: string): NameResolution => ({
  name,
  uses: 1,
  timed: false,
  unilateral: false,
  unreadable: true,
})

describe('classifyUpdate', () => {
  it('applies in full when every exercise is already in the library', () => {
    const result = classifyUpdate([known('Barbell Back Squat'), known('Bench Press')])

    expect(result.safe).toBe(true)
    expect(result.holdback).toEqual([])
    expect(result.decisions.size).toBe(0)
  })

  it('holds back a lift the library has never seen, and skips it', () => {
    const result = classifyUpdate([known('Bench Press'), unknown('Copenhagen Plank')])

    expect(result.safe).toBe(false)
    expect(result.holdback).toHaveLength(1)
    expect(result.holdback[0]).toMatchObject({ name: 'Copenhagen Plank', reason: 'unknown' })
    // The rest of the routine still applies — one new accessory must not block
    // a set-count change to the other six.
    expect(result.decisions.get('Copenhagen Plank')).toEqual({ action: 'skip' })
    expect(result.decisions.has('Bench Press')).toBe(false)
  })

  it('holds back an unreadable line rather than guessing at it', () => {
    const result = classifyUpdate([unreadable('chest row   x6 @')])

    expect(result.safe).toBe(false)
    expect(result.holdback[0]!.reason).toBe('unreadable')
    expect(result.decisions.get('chest row   x6 @')).toEqual({ action: 'skip' })
  })

  it('never auto-links a near miss, however close', () => {
    const suggestion = exercise('Chest-supported row')
    const result = classifyUpdate([
      { name: 'Chest supported row', uses: 2, timed: false, unilateral: false, unreadable: false, suggestion },
    ])

    // Acting on a suggestion is acting on a guess, which is the failure this
    // whole path exists to prevent. It is offered, not applied.
    expect(result.safe).toBe(false)
    expect(result.decisions.get('Chest supported row')).toEqual({ action: 'skip' })
    expect(result.holdback[0]!.suggestion).toBe(suggestion)
  })

  it('surfaces unreadable lines first, then by how much of the routine they affect', () => {
    const result = classifyUpdate([
      unknown('Copenhagen Plank', 1),
      unknown('Hip Airplane', 3),
      unreadable('row   x6 @'),
    ])

    expect(result.holdback.map((h) => h.name)).toEqual([
      'row   x6 @',
      'Hip Airplane',
      'Copenhagen Plank',
    ])
  })

  it('treats an unreadable name as unreadable even if something matched it', () => {
    // resolveNames can attach an existing entry to a line it still could not
    // read; the safe reading is the pessimistic one.
    const result = classifyUpdate([{ ...known('Plank'), unreadable: true }])

    expect(result.safe).toBe(false)
    expect(result.holdback[0]!.reason).toBe('unreadable')
  })
})
