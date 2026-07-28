import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseRoutineCsv, splitCsv } from './parseRoutineCsv'

const COMMA = `routine,day,order,exercise,sets,note
GZCLP,Day A,1,Barbell Back Squat,5,5x3+ T1
GZCLP,Day A,2,Bench Press,3,3x10 T2
GZCLP,Day B,1,Deadlift,5,`

describe('detectDelimiter', () => {
  it('finds commas', () => {
    expect(detectDelimiter(COMMA)).toBe(',')
  })

  it('finds semicolons, as written by Excel in a comma-decimal locale', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })

  it('finds tabs', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })

  it('is not fooled by commas inside quoted fields', () => {
    // The commas here are consistent on every line, including the header, so a
    // counter that ignored quotes would tie with ';' and pick ',' first.
    const text = 'exercise;"note, detail"\nSquat;"top, then backoff"\nBench;"paused, close"'
    expect(detectDelimiter(text)).toBe(';')
  })

  it('falls back to a comma when there is only one column', () => {
    expect(detectDelimiter('Squat\nBench\nDeadlift')).toBe(',')
  })
})

describe('splitCsv', () => {
  it('handles quoted fields, escaped quotes and CRLF', () => {
    const rows = splitCsv('a,b\r\n"x,1","he said ""hi"""\r\n', ',')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
    ])
  })

  it('drops rows that are entirely blank', () => {
    expect(splitCsv('a,b\n\n\nc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseRoutineCsv', () => {
  it('reads a comma file into days and items', () => {
    const routine = parseRoutineCsv(COMMA)
    expect(routine.name).toBe('GZCLP')
    expect(routine.days.map((d) => d.name)).toEqual(['Day A', 'Day B'])
    expect(routine.days[0]!.items).toEqual([
      { exercise: 'Barbell Back Squat', plannedSets: 5, note: '5x3+ T1', recognised: true, rawSets: 5 },
      { exercise: 'Bench Press', plannedSets: 3, note: '3x10 T2', recognised: true, rawSets: 3 },
    ])
    expect(routine.days[1]!.items[0]).toMatchObject({ exercise: 'Deadlift', plannedSets: 5 })
  })

  it('reads the same file written with semicolons', () => {
    const semi = COMMA.replace(/,/g, ';')
    const routine = parseRoutineCsv(semi)
    expect(routine.days).toHaveLength(2)
    expect(routine.days[0]!.items[0]!.exercise).toBe('Barbell Back Squat')
    expect(routine.warnings.some((w) => w.includes(';'))).toBe(true)
  })

  it('parses a file carrying the UTF-8 BOM Excel prepends', () => {
    const routine = parseRoutineCsv(`﻿${COMMA}`)
    expect(routine.name).toBe('GZCLP')
    expect(routine.days[0]!.items[0]!.exercise).toBe('Barbell Back Squat')
  })

  it('does not leave a BOM glued to the first exercise name', () => {
    // The headerless path is where a stray BOM would end up inside the data
    // rather than in a header that gets normalised away.
    const routine = parseRoutineCsv('﻿Squat,5\nBench,3')
    const first = routine.days[0]!.items[0]!.exercise
    expect(first).toBe('Squat')
    expect(first.charCodeAt(0)).toBe('S'.charCodeAt(0))
  })

  it('needs only an exercise column', () => {
    const routine = parseRoutineCsv('exercise\nSquat\nBench Press')
    expect(routine.days).toHaveLength(1)
    expect(routine.days[0]!.name).toBe('Day 1')
    // Unspecified set counts fall back to 3.
    expect(routine.days[0]!.items).toEqual([
      { exercise: 'Squat', plannedSets: 3, note: undefined, recognised: false, rawSets: undefined },
      { exercise: 'Bench Press', plannedSets: 3, note: undefined, recognised: false, rawSets: undefined },
    ])
  })

  it('skips blank rows and reports how many', () => {
    const routine = parseRoutineCsv('exercise,sets\nSquat,5\n,3\nBench,4')
    expect(routine.days[0]!.items).toHaveLength(2)
    expect(routine.warnings.some((w) => w.includes('Skipped 1'))).toBe(true)
  })

  it('accepts Norwegian headers', () => {
    const routine = parseRoutineCsv('dag;øvelse;sett\nDag A;Knebøy;5\nDag B;Benkpress;3')
    expect(routine.days.map((d) => d.name)).toEqual(['Dag A', 'Dag B'])
    expect(routine.days[0]!.items[0]).toMatchObject({ exercise: 'Knebøy', plannedSets: 5 })
  })

  it('pulls the set count out of an exercise cell that carries the scheme', () => {
    const routine = parseRoutineCsv('exercise\nSquat 5x5\nBench 3x10')
    expect(routine.days[0]!.items).toEqual([
      { exercise: 'Squat', plannedSets: 5, note: '5x5', recognised: true, rawSets: 5 },
      { exercise: 'Bench', plannedSets: 3, note: '3x10', recognised: true, rawSets: 3 },
    ])
  })

  it('falls back to the note column for the set count', () => {
    const routine = parseRoutineCsv('exercise,note\nSquat,4x6 @RPE8')
    expect(routine.days[0]!.items[0]).toMatchObject({ plannedSets: 4, note: '4x6 @RPE8' })
  })

  it('treats a file with no recognisable header as headerless', () => {
    const routine = parseRoutineCsv('Squat,5\nBench,3')
    expect(routine.days[0]!.items).toEqual([
      { exercise: 'Squat', plannedSets: 5, note: undefined, recognised: true, rawSets: 5 },
      { exercise: 'Bench', plannedSets: 3, note: undefined, recognised: true, rawSets: 3 },
    ])
    expect(routine.warnings.some((w) => w.includes('No header row'))).toBe(true)
  })

  it('honours an explicit order column', () => {
    const routine = parseRoutineCsv(
      'day,order,exercise\nA,3,Third\nA,1,First\nA,2,Second',
    )
    expect(routine.days[0]!.items.map((i) => i.exercise)).toEqual(['First', 'Second', 'Third'])
  })

  it('clamps absurd set counts rather than seeding hundreds of rows', () => {
    expect(parseRoutineCsv('exercise,sets\nSquat,900').days[0]!.items[0]!.plannedSets).toBe(30)
    expect(parseRoutineCsv('exercise,sets\nSquat,0').days[0]!.items[0]!.plannedSets).toBe(3)
  })

  it('uses the fallback name when no routine column is present', () => {
    expect(parseRoutineCsv('exercise\nSquat', 'my-program').name).toBe('my-program')
  })

  it('throws on an empty file', () => {
    expect(() => parseRoutineCsv('')).toThrow()
  })
})
