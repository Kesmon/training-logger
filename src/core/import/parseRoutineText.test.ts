import { describe, expect, it } from 'vitest'
import { parseRoutineText } from './parseRoutineText'
import { cleanExerciseName, extractSets } from './types'

describe('cleanExerciseName', () => {
  it('rescues the lines that created junk library entries', () => {
    // These three are verbatim from a real paste that permanently added
    // exercises named after the raw text and split existing history in two.
    expect(cleanExerciseName('chest row   x6 @')).toBe('chest row')
    expect(cleanExerciseName('facepull    x15 @')).toBe('facepull')
    expect(cleanExerciseName('Squat 100kg x 5')).toBe('Squat 100kg')
  })

  it('collapses internal whitespace', () => {
    expect(cleanExerciseName('Barbell   Back    Squat')).toBe('Barbell Back Squat')
  })

  it('strips trailing separators', () => {
    expect(cleanExerciseName('Deadlift -')).toBe('Deadlift')
    expect(cleanExerciseName('Bench Press:')).toBe('Bench Press')
    expect(cleanExerciseName('Row ...')).toBe('Row')
  })

  it('leaves legitimate names alone', () => {
    for (const name of [
      'T-Bar Row',
      "Farmer's Walk",
      'Squat (paused)',
      'Barbell Back Squat',
      'Face Pull',
      'Knebøy',
      'Deadlift 1', // a variant number is not a scheme fragment
    ]) {
      expect(cleanExerciseName(name)).toBe(name)
    }
  })
})

describe('extractSets', () => {
  it('reads NxM after the movement name', () => {
    expect(extractSets('Barbell Back Squat 5x3')).toEqual({
      name: 'Barbell Back Squat',
      sets: 5,
      repsMin: 3,
      repsMax: 3,
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
      repsMin: 3,
      repsMax: 3,
      note: '5x3+ @RPE8 T1',
    })
  })

  it('reads a rep range', () => {
    expect(extractSets('Romanian Deadlift 3x8-10')).toMatchObject({
      name: 'Romanian Deadlift',
      sets: 3,
      repsMin: 8,
      repsMax: 10,
    })
  })

  it('does not read a note separator as a rep range', () => {
    // "2x6 — 3 RIR" is how a prescription with a note is actually written. Read
    // as a range it inverts to 6-to-3, which is not a prescription at all.
    expect(extractSets('Chest-supported row 2x6 — 3 RIR. Weekly upper body dose.')).toMatchObject({
      name: 'Chest-supported row',
      sets: 2,
      repsMin: 6,
      repsMax: 6,
    })
    expect(extractSets('Face pull 2x15 - light')).toMatchObject({ repsMin: 15, repsMax: 15 })
  })

  it('reads a duration rather than reps for timed work', () => {
    expect(extractSets('Plank 3x30s')).toMatchObject({ sets: 3, durationSec: 30 })
    expect(extractSets('Plank 3x2min')).toMatchObject({ sets: 3, durationSec: 120 })
    expect(extractSets('Plank 3x30s').repsMin).toBeUndefined()
  })

  it('does not read a distance as reps', () => {
    // Twenty metres, not twenty reps.
    expect(extractSets("Farmer's Walk 2x20m")).toMatchObject({ sets: 2 })
    expect(extractSets("Farmer's Walk 2x20m").repsMin).toBeUndefined()
  })

  it('spots unilateral work however it is written', () => {
    for (const line of [
      'Bulgarian Split Squat 2x10 per leg',
      'Pallof press 3x12 each side',
      'Single-Leg Glute Bridge 3x10/side',
      'Reverse Lunge 2x8 per side',
    ]) {
      expect(extractSets(line).unilateral, line).toBe(true)
    }
  })

  it('does not call ordinary work unilateral', () => {
    for (const line of ['Barbell Back Squat 5x5', 'Bench Press 3x8', 'Plank 3x30s']) {
      expect(extractSets(line).unilateral, line).toBeUndefined()
    }
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
      plannedRepsMin: 3,
      plannedRepsMax: 3,
      recognised: true,
      rawSets: 5,
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

  it('strips inline Markdown from names', () => {
    const routine = parseRoutineText(`# **Winter block**
## _Day A_
- **Barbell Back Squat** 5x3
- \`Bench Press\` 3x10
- [Romanian Deadlift](https://example.com/rdl) 3x8`)

    expect(routine.name).toBe('Winter block')
    expect(routine.days[0]!.name).toBe('Day A')
    expect(routine.days[0]!.items.map((i) => i.exercise)).toEqual([
      'Barbell Back Squat',
      'Bench Press',
      'Romanian Deadlift',
    ])
  })

  it('leaves a single asterisk alone, since it is also a set separator', () => {
    const routine = parseRoutineText('- Squat 5*5')
    expect(routine.days[0]!.items[0]).toMatchObject({ exercise: 'Squat', plannedSets: 5 })
  })

  it('accepts task-list checkboxes', () => {
    const routine = parseRoutineText(`## Day A
- [ ] Squat 5x5
- [x] Bench Press 3x8`)
    expect(routine.days[0]!.items.map((i) => i.exercise)).toEqual(['Squat', 'Bench Press'])
  })

  it('marks lines with no recognisable scheme as unrecognised', () => {
    const routine = parseRoutineText(`## Day A
- chest row   x6 @
- Bench Press 3x8`)
    expect(routine.days[0]!.items[0]).toMatchObject({
      exercise: 'chest row',
      recognised: false,
    })
    expect(routine.days[0]!.items[1]).toMatchObject({
      exercise: 'Bench Press',
      recognised: true,
    })
  })

  it('keeps the raw set count so absurd values can be warned about', () => {
    const item = parseRoutineText('- Squat 40x5').days[0]!.items[0]!
    expect(item.rawSets).toBe(40)
    expect(item.plannedSets).toBe(30) // still clamped for storage
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
