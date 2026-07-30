import { describe, expect, it } from 'vitest'
import {
  describeChange,
  diffRoutines,
  snapshotOfParsed,
  type RoutineSnapshot,
} from './diffRoutines'
import { parseRoutineText } from './parseRoutineText'

const routine = (
  ...days: [string, ...{ exercise: string; plannedSets: number; note?: string }[]][]
): RoutineSnapshot => ({
  days: days.map(([name, ...items]) => ({ name, items })),
})

describe('diffRoutines', () => {
  it('is empty when nothing changed', () => {
    const before = routine(['Day A', { exercise: 'Squat', plannedSets: 5 }])
    expect(diffRoutines(before, before)).toEqual([])
  })

  it('reports a set count change in both directions', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }]),
      routine(['Day A', { exercise: 'Squat', plannedSets: 4 }]),
    )

    expect(changes).toEqual([
      { kind: 'sets-changed', day: 'Day A', exercise: 'Squat', from: 5, to: 4 },
    ])
    expect(describeChange(changes[0]!)).toBe('Day A · Squat 5 → 4 sets')
  })

  it('reports an added and a removed exercise', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }, { exercise: 'Leg Curl', plannedSets: 3 }]),
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }, { exercise: 'Face pull', plannedSets: 3 }]),
    )

    expect(changes).toContainEqual({
      kind: 'exercise-removed',
      day: 'Day A',
      exercise: 'Leg Curl',
    })
    expect(changes).toContainEqual({
      kind: 'exercise-added',
      day: 'Day A',
      exercise: 'Face pull',
    })
  })

  it('reports a reorder without calling it an add and a remove', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }, { exercise: 'Bench', plannedSets: 3 }]),
      routine(['Day A', { exercise: 'Bench', plannedSets: 3 }, { exercise: 'Squat', plannedSets: 5 }]),
    )

    expect(changes).toEqual([{ kind: 'reordered', day: 'Day A' }])
  })

  it('does not call an insertion a reorder', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }, { exercise: 'Bench', plannedSets: 3 }]),
      routine(
        ['Day A',
          { exercise: 'Squat', plannedSets: 5 },
          { exercise: 'Face pull', plannedSets: 3 },
          { exercise: 'Bench', plannedSets: 3 }],
      ),
    )

    expect(changes).toEqual([{ kind: 'exercise-added', day: 'Day A', exercise: 'Face pull' }])
  })

  it('does not report a note change for the scheme the note restates', () => {
    // extractSets keeps the scheme as the note, so "Squat 5x5" has note "5x5".
    // Reporting that as a note edit would double every set-count change.
    const before = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 5x5'))
    const after = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 4x5'))

    expect(diffRoutines(before, after)).toEqual([
      { kind: 'sets-changed', day: 'Day A', exercise: 'Squat', from: 5, to: 4 },
    ])
  })

  it('still reports words the coach added alongside a set change', () => {
    const before = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 5x5'))
    const after = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 4x5 belt on'))

    expect(diffRoutines(before, after)).toContainEqual({
      kind: 'note-changed',
      day: 'Day A',
      exercise: 'Squat',
    })
  })

  it('notices a changed note, since it carries the coach’s instruction', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5, note: '5x3+ T1' }]),
      routine(['Day A', { exercise: 'Squat', plannedSets: 5, note: '5x3+ T1 — belt on' }]),
    )

    expect(changes).toEqual([{ kind: 'note-changed', day: 'Day A', exercise: 'Squat' }])
  })

  it('matches exercises across spelling differences that mean the same lift', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Barbell Back-Squat', plannedSets: 5 }]),
      routine(['Day A', { exercise: 'barbell back squat', plannedSets: 4 }]),
    )

    expect(changes).toEqual([
      { kind: 'sets-changed', day: 'Day A', exercise: 'barbell back squat', from: 5, to: 4 },
    ])
  })

  it('reports whole days appearing and disappearing', () => {
    const changes = diffRoutines(
      routine(['Day A', { exercise: 'Squat', plannedSets: 5 }]),
      routine(
        ['Day A', { exercise: 'Squat', plannedSets: 5 }],
        ['Day B', { exercise: 'Deadlift', plannedSets: 3 }],
      ),
    )

    expect(changes).toEqual([{ kind: 'day-added', day: 'Day B' }])
  })

  it('reads a rep range change off two real parsed routines', () => {
    const before = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Bench Press 3x8'))
    const after = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Bench Press 3x8-10'))

    const changes = diffRoutines(before, after)
    const reps = changes.find((c) => c.kind === 'reps-changed')

    expect(reps).toMatchObject({ from: '8', to: '8–10' })
    expect(describeChange(reps!)).toBe('Day A · Bench Press 8 → 8–10 reps')
  })

  it('sees nothing in a republish that only gained a trailing blank line', () => {
    const before = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 5x5'))
    const after = snapshotOfParsed(parseRoutineText('# B\n## Day A\n- Squat 5x5\n\n'))

    // The bytes differ, so the hash gate opens. This is the second gate that
    // stops a cosmetic republish cutting a routine version.
    expect(diffRoutines(before, after)).toEqual([])
  })
})
