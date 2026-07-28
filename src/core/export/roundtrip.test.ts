import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSet,
  createExercise,
  setSetStatus,
  finishSession,
  startSession,
  updateSet,
  seedSessionFromRoutineDay,
  updateSession,
} from '../../db/queries'
import { db } from '../../db/schema'
import { commitRoutine, resolveNames } from '../import/apply'
import { parseRoutineText } from '../import/parseRoutineText'
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
    const csv = bundleToCsv(await buildBundle(), 'international')
    const lines = csv.split('\r\n')

    expect(lines[0]).toContain('schema_version,date,routine_id,routine_name')
    expect(lines).toHaveLength(4) // header + 3 sets

    const header = lines[0]!.split(',')
    const working = lines.find((l) => l.includes('137.5'))!.split(',')
    const col = (name: string) => working[header.indexOf(name)]

    expect(col('exercise_name')).toBe('Barbell Back Squat')
    expect(col('routine_name')).toBe('GZCLP')
    expect(col('set_type')).toBe('working')
    expect(col('weight_kg')).toBe('137.5')
    expect(col('reps')).toBe('5')
    expect(col('effort_value')).toBe('8')
    expect(col('volume_kg')).toBe('687.5')
    expect(col('set_category')).toBe('working')
    // Dropped deliberately: the method depended on the values, so the number
    // could not be reproduced from the file.
    expect(header).not.toContain('e1rm_kg')
  })

  it('leaves volume blank for warm-ups', async () => {
    await seed()
    const csv = bundleToCsv(await buildBundle())
    const header = csv.split('\r\n')[0]!.split(',')
    const warmup = csv.split('\r\n').find((l) => l.includes('warmup'))!.split(',')
    expect(warmup[header.indexOf('volume_kg')]).toBe('')
    expect(warmup[header.indexOf('set_category')]).toBe('preparatory')
    expect(warmup[header.indexOf('working_set_number')]).toBe('')
  })

  it('switches delimiter and decimal mark together for European Excel', async () => {
    await seed()
    const csv = bundleToCsv(await buildBundle(), 'european')
    expect(csv.split('\r\n')[0]).toContain('schema_version;date')
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
    expect(col('logged_at')).toBe('')
    // Identity and ordering are still present — that is the point of the row.
    expect(col('exercise_name')).toBe('Squat')
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

  it('carries the prescription alongside what was done', async () => {
    // A routine day, laid out and then partly performed — the case the whole
    // schema exists for.
    const squat = await createExercise({ name: 'Barbell Back Squat', equipment: 'barbell' })
    const parsed = parseRoutineText('# Block 1\n## Day A\n- Barbell Back Squat 3x8-10')
    const { routineId } = await commitRoutine(parsed, await resolveNames(parsed), new Map())

    const day = (await db.routineDays.where('routineId').equals(routineId).toArray())[0]!
    const routine = (await db.routines.get(routineId))!
    const session = await startSession({
      routineId,
      routineDayId: day.id,
      routineName: routine.name,
      routineVersion: routine.version,
      dayName: day.name,
    })
    await seedSessionFromRoutineDay(session.id, day.id)

    const laid = await db.setEntries.where('sessionId').equals(session.id).toArray()
    expect(laid).toHaveLength(3)

    // Two done, one skipped, plus a fourth beyond the prescription.
    laid.sort((a, b) => a.setNumber - b.setNumber)
    for (const s of laid.slice(0, 2)) {
      await updateSet(s.id, { weightKg: 100, reps: 9 })
      await setSetStatus(s.id, 'completed')
    }
    await setSetStatus(laid[2]!.id, 'skipped')
    const extra = await addSet(session.id, squat)
    await updateSet(extra.id, { weightKg: 90, reps: 12 })
    await setSetStatus(extra.id, 'completed')
    await finishSession(session.id)

    const rows = bundleToCsv(await buildBundle()).split('\r\n')
    const header = rows[0]!.split(',')
    const cols = (r: string) =>
      Object.fromEntries(header.map((h, i) => [h, r.split(',')[i]])) as Record<string, string>
    const body = rows.slice(1).map(cols)

    expect(body).toHaveLength(4)
    expect(body.map((r) => r.planned_sets)).toEqual(['3', '3', '3', '3'])
    // A range is carried as both bounds, so nothing has to be parsed back out.
    expect(body.map((r) => r.planned_reps_min)).toEqual(['8', '8', '8', '8'])
    expect(body.map((r) => r.planned_reps_max)).toEqual(['10', '10', '10', '10'])
    expect(body.map((r) => r.set_status)).toEqual([
      'completed',
      'completed',
      'skipped',
      'completed',
    ])
    // The fourth set is the one beyond the prescription.
    expect(body.map((r) => r.working_set_number)).toEqual(['1', '2', '3', '4'])
    expect(body.map((r) => r.is_extra)).toEqual(['false', 'false', 'false', 'true'])
    expect(body[0]!.routine_name).toBe('Block 1')
    expect(body[0]!.routine_version).toBe('1')
    expect(body[0]!.routine_id).toBe(routineId)
  })

  it('does not let warm-ups or drop sets shift the extra-set position', async () => {
    // set_number counts every row; comparing it against planned_sets would flag
    // prescribed work as extra the moment a warm-up exists.
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession({ dayName: 'Day A' })

    const rows: [string, number][] = [
      ['warmup', 60],
      ['warmup', 80],
      ['working', 100],
      ['working', 100],
      ['drop', 70],
      ['working', 100],
    ]
    for (const [setType, weightKg] of rows) {
      const s = await addSet(session.id, squat)
      await updateSet(s.id, { setType: setType as never, weightKg, reps: 5, plannedSets: 3 })
      await setSetStatus(s.id, 'completed')
    }
    await finishSession(session.id)

    const lines = bundleToCsv(await buildBundle()).split('\r\n')
    const header = lines[0]!.split(',')
    const body = lines
      .slice(1)
      .map((r) => Object.fromEntries(header.map((h, i) => [h, r.split(',')[i]])))

    expect(body.map((r) => r.set_category)).toEqual([
      'preparatory',
      'preparatory',
      'working',
      'working',
      'continuation',
      'working',
    ])
    // Only the three working sets get a position, and none exceeds 3.
    expect(body.map((r) => r.working_set_number)).toEqual(['', '', '1', '2', '', '3'])
    expect(body.map((r) => r.is_extra)).toEqual(['', '', 'false', 'false', '', 'false'])
  })

  it('blanks logged_gap_sec rather than reporting a negative interval', async () => {
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession()

    const a = await addSet(session.id, squat)
    const b = await addSet(session.id, squat)
    await updateSet(a.id, { weightKg: 100, reps: 5 })
    await updateSet(b.id, { weightKg: 100, reps: 5 })
    await setSetStatus(a.id, 'completed')
    await setSetStatus(b.id, 'completed')
    // Ticked out of order, which is what produced timestamps running backwards.
    await updateSet(a.id, { loggedAt: '2026-07-28T12:41:10Z' })
    await updateSet(b.id, { loggedAt: '2026-07-28T12:41:08Z' })
    await finishSession(session.id)

    const lines = bundleToCsv(await buildBundle()).split('\r\n')
    const header = lines[0]!.split(',')
    const gaps = lines.slice(1).map((r) => r.split(',')[header.indexOf('logged_gap_sec')])
    expect(gaps).toEqual(['', ''])
  })

  it('shapes timed and unilateral exercises from the routine that describes them', async () => {
    const parsed = parseRoutineText(
      '# Block 2\n## Day A\n- Plank 3x30s\n- Bulgarian Split Squat 2x10 per leg',
    )
    const { routineId } = await commitRoutine(parsed, await resolveNames(parsed), new Map())

    const made = await db.exercises.toArray()
    const plank = made.find((e) => e.name === 'Plank')!
    const split = made.find((e) => e.name === 'Bulgarian Split Squat')!

    // A plank has nowhere to put a weight, and its duration needs a home.
    expect(plank.fields).toEqual(['time', 'effort'])
    expect(plank.equipment).toBe('bodyweight')
    expect(split.isUnilateral).toBe(true)

    const day = (await db.routineDays.where('routineId').equals(routineId).toArray())[0]!
    const session = await startSession({ routineId, routineDayId: day.id, dayName: day.name })
    await seedSessionFromRoutineDay(session.id, day.id)

    const sets = await db.setEntries.where('sessionId').equals(session.id).toArray()
    const bySetNumber = (a: { setNumber: number }, b: { setNumber: number }) =>
      a.setNumber - b.setNumber
    const splitSets = sets.filter((s) => s.exerciseId === split.id).sort(bySetNumber)
    const plankSets = sets.filter((s) => s.exerciseId === plank.id).sort(bySetNumber)

    // 2x10 per leg is two rows, not four.
    expect(splitSets).toHaveLength(2)
    expect(splitSets.every((s) => s.perSide === true)).toBe(true)
    expect(plankSets).toHaveLength(3)
    expect(plankSets.every((s) => s.plannedDurationSec === 30)).toBe(true)

    // Perform one of each: the held duration and the per-limb reps.
    await updateSet(plankSets[0]!.id, { timeSec: 22 })
    await setSetStatus(plankSets[0]!.id, 'completed')
    await updateSet(splitSets[0]!.id, { weightKg: 20, reps: 10 })
    await setSetStatus(splitSets[0]!.id, 'completed')
    await finishSession(session.id)

    const lines = bundleToCsv(await buildBundle()).split('\r\n')
    const header = lines[0]!.split(',')
    const row = (name: string) =>
      Object.fromEntries(
        header.map((h, i) => [h, lines.slice(1).find((l) => l.includes(name))!.split(',')[i]]),
      ) as Record<string, string>

    const plankRow = row('Plank')
    expect(plankRow.schema_version).toBe('3')
    // Prescribed 30, held 22 — kept apart rather than collapsed.
    expect(plankRow.planned_duration_sec).toBe('30')
    expect(plankRow.duration_sec).toBe('22')

    const splitRow = row('Bulgarian')
    expect(splitRow.per_side).toBe('true')
    expect(splitRow.reps).toBe('10')
    // Both limbs did ten reps at 20 kg.
    expect(splitRow.volume_kg).toBe('400')
  })

  it('carries session RPE, bodyweight and note once they are entered', async () => {
    const squat = await createExercise({ name: 'Squat', equipment: 'barbell' })
    const session = await startSession({ dayName: 'Day A' })
    const set = await addSet(session.id, squat)
    await updateSet(set.id, { weightKg: 100, reps: 5 })
    await setSetStatus(set.id, 'completed')
    await updateSession(session.id, {
      sessionRpe: 8,
      bodyweightKg: 62.5,
      notes: 'Left knee felt off',
    })
    await finishSession(session.id)

    const lines = bundleToCsv(await buildBundle()).split('\r\n')
    const header = lines[0]!.split(',')
    const body = lines[1]!.split(',')
    const col = (n: string) => body[header.indexOf(n)]

    // These three had no UI at all, so they could never be anything but blank.
    expect(col('session_rpe')).toBe('8')
    expect(col('bodyweight_kg')).toBe('62.5')
    expect(col('session_note')).toBe('Left knee felt off')
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
