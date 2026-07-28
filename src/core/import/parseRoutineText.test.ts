import { describe, expect, it } from 'vitest'
import { parseRoutineText } from './parseRoutineText'
import { extractSets } from './types'

describe('extractSets', () => {
  it('reads NxM after the movement name', () => {
    expect(extractSets('Barbell Back Squat 5x3')).toEqual({
      name: 'Barbell Back Squat',
      sets: 5,
      note: '5x3',
    })
  })

  it('accepts the × character and spacing', () => {
    expect(extractSets('Bench Press 3 × 10')).toMatchObject({ name: 'Bench Press', sets: 3 })
  })

  it('keeps trailing prescription text as the note', () => {
    expect(extractSets('Squat 5x3+ @RPE8 T1')).toEqual({
      name: 'Squat',
      sets: 5,
      note: '5x3+ @RPE8 T1',
    })
  })

  it('reads a written-out set count', () => {
    expect(extractSets('Lat Pulldown 4 sets of 12')).toMatchObject({
      name: 'Lat Pulldown',
      sets: 4,
    })
  })

  it('returns just the name when there is no scheme', () => {
    expect(extractSets('Face Pull')).toEqual({ name: 'Face Pull' })
  })
})

describe('parseRoutineText', () => {
  it('reads headed Markdown', () => {
    const routine = parseRoutineText(`# GZCLP

## Day A
- Barbell Back Squat 5x3+
- Bench Press 3x10
- Lat Pulldown 3x12

## Day B
- Deadlift 5x3`)

    expect(routine.name).toBe('GZCLP')
    expect(routine.days.map((d) => d.name)).toEqual(['Day A', 'Day B'])
    expect(routine.days[0]!.items).toHaveLength(3)
    expect(routine.days[0]!.items[0]).toEqual({
      exercise: 'Barbell Back Squat',
      plannedSets: 5,
      note: '5x3+',
    })
    expect(routine.days[1]!.items[0]!.exercise).toBe('Deadlift')
  })

  it('turns a bare list into a one-day routine', () => {
    const routine = parseRoutineText('Squat 5x5\nBench 5x5\nRow 5x5')
    expect(routine.days).toHaveLength(1)
    expect(routine.days[0]!.name).toBe('Day 1')
    expect(routine.days[0]!.items.map((i) => i.exercise)).toEqual(['Squat', 'Bench', 'Row'])
    expect(routine.warnings.some((w) => w.includes('# Routine name'))).toBe(true)
  })

  it('accepts mixed bullet styles', () => {
    const routine = parseRoutineText(`## Day A
- Squat 3x5
* Bench 3x5
+ Row 3x5
1. Curl 3x12
2) Pushdown 3x12`)
    expect(routine.days[0]!.items.map((i) => i.exercise)).toEqual([
      'Squat',
      'Bench',
      'Row',
      'Curl',
      'Pushdown',
    ])
  })

  it('treats a trailing colon as a day heading', () => {
    const routine = parseRoutineText(`Push:
- Bench 4x6
Pull:
- Row 4x6`)
    expect(routine.days.map((d) => d.name)).toEqual(['Push', 'Pull'])
    expect(routine.days[1]!.items[0]!.exercise).toBe('Row')
  })

  it('handles ### as the day level when ## is not used', () => {
    const routine = parseRoutineText(`# Program
### Day 1
- Squat 5x5`)
    expect(routine.name).toBe('Program')
    expect(routine.days[0]!.name).toBe('Day 1')
  })

  it('defaults to three sets when none is given', () => {
    expect(parseRoutineText('- Face Pull').days[0]!.items[0]!.plannedSets).toBe(3)
  })

  it('drops headings with nothing under them', () => {
    const routine = parseRoutineText(`## Day A
- Squat 5x5

## Day B (rest)`)
    expect(routine.days).toHaveLength(1)
    expect(routine.warnings.some((w) => w.includes('Ignored'))).toBe(true)
  })

  it('throws when there are no exercises at all', () => {
    expect(() => parseRoutineText('# Just a title\n\n## And a day')).toThrow()
  })
})
