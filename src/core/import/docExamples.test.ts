import { describe, expect, it } from 'vitest'
// Imported through Vite rather than node:fs, so this needs no Node types in an
// otherwise browser-only project — and the guide becomes a real dependency of
// the test rather than something read at an assumed path.
import DOC from '../../../docs/routine-format.md?raw'
import { parseRoutineText } from './parseRoutineText'

/**
 * Parses the examples in docs/routine-format.md with the real parser, so the
 * guide cannot quietly drift away from what the app actually does.
 */

function fences(): string[] {
  const out: string[] = []
  const re = /```markdown\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(DOC))) out.push(m[1]!)
  return out
}

/** Fences that are whole routines, not fragments illustrating one heading. */
function routineFences(): string[] {
  return fences().filter((f) =>
    f.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#')),
  )
}

const byRoutineName = (name: string) => {
  const block = fences().find((f) => f.includes(`# ${name}`))
  if (!block) throw new Error(`No example titled "${name}" in the guide`)
  return parseRoutineText(block)
}

describe('the guide is accurate', () => {
  it('contains the examples it claims to', () => {
    expect(fences().length).toBeGreaterThanOrEqual(8)
  })

  it('parses every complete Markdown example without error', () => {
    const blocks = routineFences()
    expect(blocks.length).toBeGreaterThanOrEqual(7)
    for (const block of blocks) {
      expect(() => parseRoutineText(block), `failed on:\n${block}`).not.toThrow()
    }
  })

  it('the opening example gives 2 days and 5 squat sets', () => {
    const r = byRoutineName('Winter Block')
    expect(r.days.map((d) => d.name)).toEqual([
      'Day A — Squat / Bench',
      'Day B — Deadlift / Press',
    ])
    expect(r.days[0]!.items).toHaveLength(4)
    expect(r.days[0]!.items[0]).toMatchObject({
      exercise: 'Barbell Back Squat',
      plannedSets: 5,
    })
    // Documented default when no scheme is given.
    expect(r.days[0]!.items[3]).toMatchObject({ exercise: 'Face Pull', plannedSets: 3 })
  })

  it('the strength block gives 4 days with notes preserved', () => {
    const r = byRoutineName('5/3/1 Boring But Big')
    expect(r.days).toHaveLength(4)
    expect(r.days[0]!.items[0]).toMatchObject({
      exercise: 'Barbell Back Squat',
      plannedSets: 3,
      note: '3x5 — 65/75/85%, last set AMRAP',
    })
    expect(r.days[0]!.items[1]).toMatchObject({ plannedSets: 5, note: '5x10 @50% — BBB' })
  })

  it('the hypertrophy split gives 3 days', () => {
    const r = byRoutineName('Push Pull Legs')
    expect(r.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs'])
    expect(r.days[0]!.items).toHaveLength(5)
    expect(r.days[0]!.items[1]).toMatchObject({
      exercise: 'Incline DB Press',
      plannedSets: 3,
      note: '3x10 RIR1, 3-1-1-0',
    })
  })

  it('the traps really are traps, exactly as described', () => {
    // Trap 1: the first number is always sets, and it is flagged above 8.
    expect(parseRoutineText('- Squat 100x5').days[0]!.items[0]).toMatchObject({
      exercise: 'Squat',
      plannedSets: 30,
      rawSets: 100, // the preview warns using the raw value, not the cap
      recognised: true,
    })

    // Trap 2: weight before the scheme. The fragment is stripped and the line
    // is marked unrecognised, which is what keeps it out of the library.
    expect(parseRoutineText('- Squat 100kg x 5').days[0]!.items[0]).toMatchObject({
      exercise: 'Squat 100kg',
      plannedSets: 3,
      recognised: false,
    })

    // Trap 3: stray prose is still parsed as an item, but unrecognised — the
    // import preview is what stops it becoming an exercise.
    const prose = parseRoutineText('## Day A\n- Squat 5x5\n\nDeload every fourth week.')
    expect(prose.days[0]!.items.map((i) => i.exercise)).toEqual([
      'Squat',
      'Deload every fourth week',
    ])
    expect(prose.days[0]!.items[1]!.recognised).toBe(false)
    expect(prose.days[0]!.items[0]!.recognised).toBe(true)
    // a deeper heading extends the day name rather than splitting it
    const deep = parseRoutineText('## Day A\n### Main\n- Squat 5x5\n### Accessory\n- Curl 3x12')
    expect(deep.days).toHaveLength(1)
    expect(deep.days[0]!.name).toBe('Day A · Main · Accessory')
    expect(deep.days[0]!.items).toHaveLength(2)
  })

  it('every set-notation row in the reference table behaves as documented', () => {
    const expected: [string, number][] = [
      ['Squat 5x3', 5],
      ['Squat 5 x 3', 5],
      ['Squat 5x3+', 5],
      ['Squat 3x8-10', 3],
      ['Plank 3x30s', 3],
      ['Plank 3x2min', 3],
      ["Farmer's Walk 2x20m", 2],
      ['Split Squat 2x10 per leg', 2],
      ['Lat Pulldown 4 sets of 12', 4],
      ['Knebøy 4 sett', 4],
      ['Face Pull', 3],
    ]
    for (const [line, sets] of expected) {
      const item = parseRoutineText(`- ${line}`).days[0]!.items[0]!
      expect(item.plannedSets, `"${line}"`).toBe(sets)
      // The table claims every row in it appears verbatim in the guide.
      expect(DOC, `"${line}" missing from the guide`).toContain(line)
    }
  })

  it('the reference table is right about what the second number means', () => {
    const item = (line: string) => parseRoutineText(`- ${line}`).days[0]!.items[0]!

    // Reps, plain and as a range.
    expect(item('Squat 5x3')).toMatchObject({ plannedRepsMin: 3, plannedRepsMax: 3 })
    expect(item('Squat 3x8-10')).toMatchObject({ plannedRepsMin: 8, plannedRepsMax: 10 })

    // A hold, not reps.
    expect(item('Plank 3x30s')).toMatchObject({ plannedDurationSec: 30 })
    expect(item('Plank 3x30s').plannedRepsMin).toBeUndefined()
    expect(item('Plank 3x2min')).toMatchObject({ plannedDurationSec: 120 })

    // A distance, not reps.
    expect(item("Farmer's Walk 2x20m").plannedRepsMin).toBeUndefined()

    // Per side.
    expect(item('Split Squat 2x10 per leg')).toMatchObject({
      plannedSets: 2,
      plannedRepsMin: 10,
      unilateral: true,
    })
  })

  it('the dash-is-not-a-range examples behave as the guide says', () => {
    const item = (line: string) => parseRoutineText(`- ${line}`).days[0]!.items[0]!

    expect(item('Romanian Deadlift 3x8-10')).toMatchObject({
      plannedRepsMin: 8,
      plannedRepsMax: 10,
    })
    // Six reps with a note, not a range of six down to three.
    expect(item('Chest-supported row 2x6 — 3 RIR')).toMatchObject({
      exercise: 'Chest-supported row',
      plannedSets: 2,
      plannedRepsMin: 6,
      plannedRepsMax: 6,
    })

    for (const line of ['Romanian Deadlift 3x8-10', 'Chest-supported row 2x6 — 3 RIR']) {
      expect(DOC, `"${line}" missing from the guide`).toContain(line)
    }
  })

  it('every unilateral spelling the guide lists is recognised', () => {
    for (const line of [
      'Bulgarian Split Squat 2x10 per leg',
      'Pallof press 2x12 each side',
      'Single-Leg Glute Bridge 3x10/side',
    ]) {
      expect(parseRoutineText(`- ${line}`).days[0]!.items[0]!.unilateral, line).toBe(true)
      expect(DOC, `"${line}" missing from the guide`).toContain(line)
    }
  })
})
