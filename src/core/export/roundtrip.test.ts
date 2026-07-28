import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSet,
  createExercise,
  setSetStatus,
  finishSession,
  startSession,
  updateSet,
} from '../../db/queries'
import { db } from '../../db/schema'
import { bundleToCsv } from './toCsv'
import { buildBundle, parseBundle, restoreBundle } from './toJson'

async function wipe() {
  await Promise.all([
    db.exercises.clear(),
    db.routines.clear(),
    db.routineDays.clear(),
    db.routineItems.clear(),
    db.sessions.clear(),
    db.setEntries.clear(),
    db.settings.clear(),
  ])
}

/** A small but representative session: a warm-up, two working sets, an RPE. */
async function seed() {
  const squat = await createExercise({ name: 'Barbell Back Squat', equipment: 'barbell' })
  const session = await startSession({ dayName: 'Day A', routineName: 'GZCLP' })

  const warmup = await addSet(session.id, squat)
  await updateSet(warmup.id, { weightKg: 60, reps: 5, setType: 'warmup' })
  await setSetStatus(warmup.id, 'completed')

  const first = await addSet(session.id, squat)
  await updateSet(first.id, { weightKg: 137.5, reps: 5, effortType: 'rpe', effortValue: 8 })
  await setSetStatus(first.id, 'completed')

  const second = await addSet(session.id, squat)
  await updateSet(second.id, { weightKg: 140, reps: 5, effortType: 'rpe', effortValue: 9 })
  await setSetStatus(second.id, 'completed')

  await finishSession(session.id)
  return { squat, sessionId: session.id }
}

const sortById = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id))

beforeEach(async () => {
  await wipe()
})

describe('JSON round trip', () => {
  it('restores an identical database after a wipe', async () => {
    await seed()
    const before = await buildBundle()
    const json = JSON.stringify(before)

    await wipe()
    expect(await db.setEntries.count()).toBe(0)

    await restoreBundle(parseBundle(json), 'replace')
    const after = await buildBundle()

    expect(sortById(after.exercises)).toEqual(sortById(before.exercises))
    expect(sortById(after.sessions)).toEqual(sortById(before.sessions))
    expect(sortById(after.setEntries)).toEqual(sortById(before.setEntries))
    expect(after.settings).toEqual(before.settings)
  })

  it('survives a second round trip unchanged', async () => {
    await seed()
    const first = JSON.stringify(await buildBundle())
    await wipe()
    await restoreBundle(parseBundle(first), 'replace')
    const second = await buildBundle()
    await wipe()
    await restoreBundle(parseBundle(JSON.stringify(second)), 'replace')
    const third = await buildBundle()
    expect(sortById(third.setEntries)).toEqual(sortById(second.setEntries))
  })

  it('merges without dropping existing rows', async () => {
    await seed()
    const backup = JSON.stringify(await buildBundle())

    await wipe()
    const other = await createExercise({ name: 'Deadlift', equipment: 'barbell' })

    await restoreBundle(parseBundle(backup), 'merge')
    const names = (await db.exercises.toArray()).map((e) => e.name).sort()
    expect(names).toEqual(['Barbell Back Squat', 'Deadlift'])
    expect(await db.exercises.get(other.id)).toBeDefined()
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBundle('not json')).toThrow(/valid JSON/)
    expect(() => parseBundle('{"format":"something-else"}')).toThrow(/not a Training Logger/)
    expect(() => parseBundle('{"format":"training-logger","version":99}')).toThrow(/newer version/)
    expect(() => parseBundle('{"format":"training-logger","version":1}')).toThrow(/missing/)
  })
})

describe('CSV export', () => {
  it('writes one row per set with computed columns', async () => {
    await seed()
    const csv = bundleToCsv(await buildBundle(), 'international', 'epley')
    const lines = csv.split('\r\n')

    expect(lines[0]).toContain('date,session_id,routine,day,exercise')
    expect(lines).toHaveLength(4) // header + 3 sets

    const header = lines[0]!.split(',')
    const working = lines.find((l) => l.includes('137.5'))!.split(',')
    const col = (name: string) => working[header.indexOf(name)]

    expect(col('exercise')).toBe('Barbell Back Squat')
    expect(col('routine')).toBe('GZCLP')
    expect(col('set_type')).toBe('working')
    expect(col('weight_kg')).toBe('137.5')
    expect(col('reps')).toBe('5')
    expect(col('effort_value')).toBe('8')
    expect(col('volume_kg')).toBe('687.5')
    // 137.5 at 5 reps @8 is 81.1% of max.
    expect(Number(col('e1rm_kg'))).toBeCloseTo(169.5, 0)
  })

  it('leaves volume and e1RM blank for warm-ups', async () => {
    await seed()
    const csv = bundleToCsv(await buildBundle())
    const header = csv.split('\r\n')[0]!.split(',')
    const warmup = csv.split('\r\n').find((l) => l.includes('warmup'))!.split(',')
    expect(warmup[header.indexOf('volume_kg')]).toBe('')
    expect(warmup[header.indexOf('e1rm_kg')]).toBe('')
  })

  it('switches delimiter and decimal mark together for European Excel', async () => {
    await seed()
    const csv = bundleToCsv(await buildBundle(), 'european')
    expect(csv.split('\r\n')[0]).toContain('date;session_id')
    // Decimals must move to ',' as well, or the ';' file still misparses.
    expect(csv).toContain('137,5')
    expect(csv).not.toContain('137.5')
  })

  it('omits blank planned sets from an unfinished session', async () => {
    await seed()
    const squat = (await db.exercises.toArray())[0]!

    // A session started from a routine holds its planned rows unticked until
    // they are actually performed. Those are not logged training.
    const live = await startSession({ dayName: 'Unfinished day' })
    await addSet(live.id, squat)
    await addSet(live.id, squat)

    const bundle = await buildBundle()
    // The backup keeps everything; only the CSV log filters.
    expect(bundle.setEntries).toHaveLength(5) // 3 logged + 2 still blank

    const rows = bundleToCsv(bundle).split('\r\n')
    expect(rows).toHaveLength(4) // header + only the 3 logged sets
    expect(rows.some((r) => r.includes('Unfinished day'))).toBe(false)
  })

  it('keeps skipped and unlogged sets from a finished session', async () => {
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession({ dayName: 'Day A' })

    const done = await addSet(session.id, squat)
    await updateSet(done.id, { weightKg: 100, reps: 5 })
    await setSetStatus(done.id, 'completed')

    // Deliberately skipped — a decision, and a different fact from...
    const skipped = await addSet(session.id, squat)
    await setSetStatus(skipped.id, 'skipped')

    // ...simply never getting to it.
    await addSet(session.id, squat)

    await finishSession(session.id)

    // Previously all three of these collapsed to one row, because finishing a
    // session deleted anything unticked.
    expect(await db.setEntries.where('sessionId').equals(session.id).count()).toBe(3)

    const rows = bundleToCsv(await buildBundle()).split('\r\n')
    const header = rows[0]!.split(',')
    const col = (row: string, name: string) => row.split(',')[header.indexOf(name)]

    expect(rows).toHaveLength(4) // header + all three
    expect(rows.slice(1).map((r) => col(r, 'set_status'))).toEqual([
      'completed',
      'skipped',
      'not_logged',
    ])
  })

  it('never exports performance data for a set that was not performed', async () => {
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession({ dayName: 'Day A' })

    const first = await addSet(session.id, squat)
    await updateSet(first.id, { weightKg: 100, reps: 5, effortType: 'rpe', effortValue: 8 })
    await setSetStatus(first.id, 'completed')

    // addSet seeds from the previous set, so this untouched row is carrying
    // 100 kg x 5 that was never lifted. It must not export as if it had been.
    const untouched = await addSet(session.id, squat)
    expect((await db.setEntries.get(untouched.id))!.weightKg).toBe(100)

    await finishSession(session.id)

    const rows = bundleToCsv(await buildBundle()).split('\r\n')
    const header = rows[0]!.split(',')
    const notLogged = rows.slice(1).find((r) => r.split(',')[header.indexOf('set_status')] === 'not_logged')!
    const col = (name: string) => notLogged.split(',')[header.indexOf(name)]

    expect(col('weight_kg')).toBe('')
    expect(col('reps')).toBe('')
    expect(col('effort_type')).toBe('')
    expect(col('effort_value')).toBe('')
    expect(col('volume_kg')).toBe('')
    expect(col('e1rm_kg')).toBe('')
    expect(col('logged_at')).toBe('')
    // Identity and ordering are still present — that is the point of the row.
    expect(col('exercise')).toBe('Squat')
    expect(col('set_number')).toBe('2')
  })

  it('does not count unperformed sets toward volume', async () => {
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession()
    const done = await addSet(session.id, squat)
    await updateSet(done.id, { weightKg: 100, reps: 5 })
    await setSetStatus(done.id, 'completed')
    await addSet(session.id, squat) // seeded 100x5, never done
    await finishSession(session.id)

    const rows = bundleToCsv(await buildBundle()).split('\r\n')
    const header = rows[0]!.split(',')
    const volumes = rows
      .slice(1)
      .map((r) => r.split(',')[header.indexOf('volume_kg')])
      .filter(Boolean)
    expect(volumes).toEqual(['500'])
  })

  it('quotes fields containing the delimiter', async () => {
    const squat = await createExercise({ name: 'Squat, paused', equipment: 'barbell' })
    const session = await startSession()
    const set = await addSet(session.id, squat)
    await updateSet(set.id, { weightKg: 100, reps: 3 })
    await setSetStatus(set.id, 'completed')
    await finishSession(session.id)

    const csv = bundleToCsv(await buildBundle(), 'international')
    expect(csv).toContain('"Squat, paused"')
  })
})
