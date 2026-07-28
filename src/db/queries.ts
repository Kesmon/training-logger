import { localDate, newId, nowIso } from '../core/ids'
import {
  DEFAULT_SETTINGS,
  db,
  type Equipment,
  type Exercise,
  type LogField,
  type Session,
  type SetEntry,
  type SetStatus,
  type Settings,
} from './schema'

/** All database access goes through this module — screens never touch `db`. */

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('settings')
  return { ...DEFAULT_SETTINGS, ...stored, id: 'settings' }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch, id: 'settings' })
}

// ----------------------------------------------------------------- exercises

/** Which inputs make sense by default for a piece of equipment. */
export function defaultFieldsFor(equipment: Equipment): LogField[] {
  switch (equipment) {
    case 'bodyweight':
      return ['reps', 'effort']
    case 'band':
      return ['band', 'reps', 'effort']
    default:
      // Includes assisted and bodyweight_loaded, where `weight` carries the
      // assistance (negative) or the added load respectively.
      return ['weight', 'reps', 'effort']
  }
}

export function defaultBarWeight(equipment: Equipment): number | undefined {
  return equipment === 'barbell' ? 20 : undefined
}

export async function listExercises(includeArchived = false): Promise<Exercise[]> {
  const all = await db.exercises.orderBy('nameLower').toArray()
  return includeArchived ? all : all.filter((e) => !e.isArchived)
}

/** Case-insensitive lookup by canonical name, then by recorded alias. */
export async function findExerciseByName(name: string): Promise<Exercise | undefined> {
  const key = name.trim().toLowerCase()
  if (!key) return undefined
  const direct = await db.exercises.where('nameLower').equals(key).first()
  if (direct) return direct
  return db.exercises.where('aliases').equals(key).first()
}

/**
 * Timed work logs a duration and an effort, not a weight and reps. Creating a
 * `Plank 3x30s` with weight/reps fields left the held duration with nowhere to
 * go, which is why `duration_sec` came back empty for an exercise whose entire
 * prescription is a duration.
 */
export const TIMED_FIELDS: LogField[] = ['time', 'effort']

export async function createExercise(input: {
  name: string
  equipment?: Equipment
  primaryMuscles?: string[]
  secondaryMuscles?: string[]
  fields?: LogField[]
  barWeightKg?: number
  isUnilateral?: boolean
  notes?: string
}): Promise<Exercise> {
  const equipment = input.equipment ?? 'barbell'
  const name = input.name.trim()
  const settings = await getSettings()
  const exercise: Exercise = {
    id: newId(),
    name,
    nameLower: name.toLowerCase(),
    aliases: [],
    equipment,
    barWeightKg: input.barWeightKg ?? defaultBarWeight(equipment),
    primaryMuscles: input.primaryMuscles ?? [],
    secondaryMuscles: input.secondaryMuscles ?? [],
    isUnilateral: input.isUnilateral,
    fields: input.fields ?? defaultFieldsFor(equipment),
    defaultEffortType: settings.defaultEffortType,
    isArchived: 0,
    createdAt: nowIso(),
    notes: input.notes,
  }
  await db.exercises.add(exercise)
  return exercise
}

export async function updateExercise(id: string, patch: Partial<Exercise>): Promise<void> {
  const next: Partial<Exercise> = { ...patch }
  if (patch.name !== undefined) {
    next.name = patch.name.trim()
    next.nameLower = next.name.toLowerCase()
  }
  await db.exercises.update(id, next)
}

/** Records `alias` as another spelling of `id`, so future imports match it. */
export async function addExerciseAlias(id: string, alias: string): Promise<void> {
  const key = alias.trim().toLowerCase()
  const ex = await db.exercises.get(id)
  if (!ex || !key || ex.nameLower === key || ex.aliases.includes(key)) return
  await db.exercises.update(id, { aliases: [...ex.aliases, key] })
}

/**
 * Exercises are archived rather than deleted when they carry history, so old
 * sessions keep resolving. Unused ones are removed outright.
 */
export async function removeExercise(id: string): Promise<'deleted' | 'archived'> {
  const used = await db.setEntries.where('exerciseId').equals(id).count()
  if (used > 0) {
    await db.exercises.update(id, { isArchived: 1 })
    return 'archived'
  }
  await db.exercises.delete(id)
  return 'deleted'
}

// ------------------------------------------------------------------ sessions

export async function getActiveSession(): Promise<Session | undefined> {
  return db.sessions.where('isComplete').equals(0).last()
}

export async function startSession(opts?: {
  routineDayId?: string
  routineId?: string
  routineName?: string
  routineVersion?: number
  dayName?: string
}): Promise<Session> {
  const session: Session = {
    id: newId(),
    date: localDate(),
    startedAt: nowIso(),
    isComplete: 0,
    ...opts,
  }
  await db.sessions.add(session)
  return session
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<void> {
  await db.sessions.update(id, patch)
}

export async function finishSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.setEntries, db.settings, async () => {
    // Untouched sets are deliberately KEPT. Deleting them used to destroy the
    // only evidence that something was planned and not done, which made a
    // skipped set indistinguishable from an unlogged one for anyone reading the
    // export. They stay as `planned` and export as `not_logged`.
    await db.sessions.update(id, { isComplete: 1, endedAt: nowIso() })

    const current = await getSettings()
    await db.settings.put({
      ...current,
      sessionsSinceExport: current.sessionsSinceExport + 1,
      id: 'settings',
    })
  })
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.setEntries, async () => {
    const sets = await db.setEntries.where('sessionId').equals(id).primaryKeys()
    await db.setEntries.bulkDelete(sets)
    await db.sessions.delete(id)
  })
}

export async function listSessions(limit?: number): Promise<Session[]> {
  const q = db.sessions.orderBy('startedAt').reverse()
  return limit ? q.limit(limit).toArray() : q.toArray()
}

// ---------------------------------------------------------------------- sets

export async function getSessionSets(sessionId: string): Promise<SetEntry[]> {
  const sets = await db.setEntries.where('sessionId').equals(sessionId).toArray()
  return sets.sort((a, b) => a.order - b.order || a.setNumber - b.setNumber)
}

/** Every logged set for one exercise, oldest first. Drives charts and PRs. */
export async function getExerciseHistory(exerciseId: string): Promise<SetEntry[]> {
  const sets = await db.setEntries.where('exerciseId').equals(exerciseId).toArray()
  return sets
    .filter((s) => s.isComplete)
    .sort((a, b) => (a.loggedAt ?? a.date).localeCompare(b.loggedAt ?? b.date))
}

/**
 * Appends a set to an exercise's block, seeding it from the previous set —
 * sets usually repeat, so this is the fastest path to a logged set.
 */
export async function addSet(
  sessionId: string,
  exercise: Exercise,
  overrides?: Partial<SetEntry>,
): Promise<SetEntry> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`No such session: ${sessionId}`)

  const existing = await getSessionSets(sessionId)
  const mine = existing.filter((s) => s.exerciseId === exercise.id)
  const previous = mine[mine.length - 1]

  // A new exercise block goes after every existing one.
  const order =
    previous?.order ?? (existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 0)

  const seed: Partial<SetEntry> = previous
    ? {
        weightKg: previous.weightKg,
        reps: previous.reps,
        effortType: previous.effortType,
        tempo: previous.tempo,
        timeSec: previous.timeSec,
        distanceM: previous.distanceM,
        bandColor: previous.bandColor,
        // Effort is deliberately not carried over: it is the thing that
        // actually changes set to set, and a stale value is worse than none.

        // The prescription carries over too, so a set added beyond what was
        // asked for still knows what was asked for — which is exactly what
        // makes it identifiable as an extra set rather than a normal one.
        plannedSets: previous.plannedSets,
        plannedRepsMin: previous.plannedRepsMin,
        plannedRepsMax: previous.plannedRepsMax,
        plannedDurationSec: previous.plannedDurationSec,
        plannedNote: previous.plannedNote,
        plannedExerciseName: previous.plannedExerciseName,
      }
    : { effortType: exercise.defaultEffortType ?? undefined }

  // Snapshotted so volume stays computable from the set alone, and so flipping
  // the exercise later cannot silently double the tonnage of logged sessions.
  const perSide = exercise.isUnilateral ? true : undefined

  const entry: SetEntry = {
    id: newId(),
    sessionId,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    date: session.date,
    order,
    setNumber: (previous?.setNumber ?? 0) + 1,
    setType: 'working',
    status: 'planned',
    perSide,
    isComplete: 0,
    ...seed,
    ...overrides,
  }
  await db.setEntries.add(entry)
  return entry
}

export async function updateSet(id: string, patch: Partial<SetEntry>): Promise<void> {
  await db.setEntries.update(id, patch)
}

/**
 * The single write path for a set's status, keeping `isComplete` in step.
 * Completing stamps the time, which is what makes the logging interval
 * derivable at export without ever building a timer.
 */
export async function setSetStatus(id: string, status: SetStatus): Promise<void> {
  await db.setEntries.update(id, {
    status,
    isComplete: status === 'completed' ? 1 : 0,
    loggedAt: status === 'completed' ? nowIso() : undefined,
  })
}

export async function deleteSet(id: string): Promise<void> {
  const set = await db.setEntries.get(id)
  if (!set) return
  await db.transaction('rw', db.setEntries, async () => {
    await db.setEntries.delete(id)
    // Renumber what is left of this exercise's block so gaps do not appear.
    const rest = await db.setEntries
      .where('sessionId')
      .equals(set.sessionId)
      .filter((s) => s.exerciseId === set.exerciseId)
      .toArray()
    rest.sort((a, b) => a.setNumber - b.setNumber)
    await Promise.all(rest.map((s, i) => db.setEntries.update(s.id, { setNumber: i + 1 })))
  })
}

/**
 * Folds one exercise into another, moving every logged set across and keeping
 * the old name as an alias so a future import of the same file matches the
 * survivor instead of recreating the duplicate.
 *
 * This is the only operation in the app that rewrites history, which is why it
 * is offered as a reviewed flow rather than run automatically on upgrade.
 */
export async function mergeExercises(fromId: string, intoId: string): Promise<number> {
  if (fromId === intoId) return 0

  return db.transaction('rw', [db.exercises, db.setEntries, db.routineItems], async () => {
    const from = await db.exercises.get(fromId)
    const into = await db.exercises.get(intoId)
    if (!from || !into) throw new Error('Both exercises must exist to merge them.')

    const sets = await db.setEntries.where('exerciseId').equals(fromId).toArray()
    await Promise.all(
      sets.map((s) =>
        db.setEntries.update(s.id, { exerciseId: intoId, exerciseName: into.name }),
      ),
    )

    // Routine slots pointing at the loser have to follow, or the next session
    // started from that routine would resurrect the duplicate. Scanned rather
    // than indexed — exerciseId is not an index here and the table is tiny.
    const items = (await db.routineItems.toArray()).filter((i) => i.exerciseId === fromId)
    await Promise.all(items.map((i) => db.routineItems.update(i.id, { exerciseId: intoId })))

    const aliases = new Set([...into.aliases, from.nameLower, ...from.aliases])
    aliases.delete(into.nameLower)
    await db.exercises.update(intoId, { aliases: [...aliases] })
    await db.exercises.delete(fromId)

    return sets.length
  })
}

/** Removes an exercise block from a session, sets and all. */
export async function removeExerciseFromSession(
  sessionId: string,
  exerciseId: string,
): Promise<void> {
  const ids = await db.setEntries
    .where('sessionId')
    .equals(sessionId)
    .filter((s) => s.exerciseId === exerciseId)
    .primaryKeys()
  await db.setEntries.bulkDelete(ids)
}

/**
 * Lays out a session from a routine day: every exercise in order, each with its
 * planned number of blank sets ready to fill in. The routine supplies structure
 * only — no weights or reps are prescribed.
 */
export async function seedSessionFromRoutineDay(
  sessionId: string,
  routineDayId: string,
): Promise<void> {
  const items = await db.routineItems.where('routineDayId').equals(routineDayId).toArray()
  items.sort((a, b) => a.order - b.order)

  for (const item of items) {
    const exercise = await db.exercises.get(item.exerciseId)
    if (!exercise) continue
    const planned = Math.max(1, Math.min(item.plannedSets || 1, 30))

    // Copied onto every set rather than joined through the routine, for the
    // same reason exerciseName is: the routine can be superseded or deleted,
    // and a logged session must still be able to say what it was asked to do.
    const prescription: Partial<SetEntry> = {
      plannedSets: planned,
      plannedRepsMin: item.plannedRepsMin,
      plannedRepsMax: item.plannedRepsMax,
      plannedDurationSec: item.plannedDurationSec,
      plannedNote: item.note,
      plannedExerciseName: item.sourceName,
    }

    for (let i = 0; i < planned; i++) {
      await addSet(sessionId, exercise, prescription)
    }
  }
}
