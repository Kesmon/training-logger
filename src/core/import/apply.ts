import { newId, nowIso } from '../ids'
import {
  TIMED_FIELDS,
  addExerciseAlias,
  createExercise,
  findExerciseByName,
  listExercises,
} from '../../db/queries'
import { db, type Equipment, type Exercise, type LogField } from '../../db/schema'
import type { ParsedRoutine } from './types'

/** Turns parsed text into database rows, matching exercises as it goes. */

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(normalise(s).split(' ').filter(Boolean))
}

function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / new Set([...ta, ...tb]).size
}

export interface NameResolution {
  name: string
  /** Set when an existing exercise matches by name or a recorded alias. */
  existing?: Exercise
  /** A close-but-not-exact candidate, offered to the user to confirm. */
  suggestion?: Exercise
  uses: number
  /** Any occurrence prescribed a duration, so it is timed work rather than reps. */
  timed: boolean
  /** Any occurrence said "per leg". */
  unilateral: boolean
  /**
   * No set scheme was recognised on the line AND nothing in the library matches
   * it — so the app has no idea what this is. Creating an exercise from a guess
   * put `chest row   x6 @` in the library permanently and split real history in
   * two, so these default to being skipped and must be confirmed by hand.
   */
  unreadable: boolean
}

export type Decision =
  | { action: 'link'; exerciseId: string }
  | { action: 'create'; equipment: Equipment }
  | { action: 'skip' }
  | { action: 'rename'; name: string; equipment: Equipment }

/** All distinct exercise names in a routine, each matched where possible. */
export async function resolveNames(parsed: ParsedRoutine): Promise<NameResolution[]> {
  const counts = new Map<string, { uses: number; recognised: boolean; timed: boolean; unilateral: boolean }>()
  for (const day of parsed.days) {
    for (const item of day.items) {
      const key = item.exercise.trim()
      if (!key) continue
      const prev = counts.get(key) ?? { uses: 0, recognised: false, timed: false, unilateral: false }
      // One good occurrence vouches for the name across the whole file.
      counts.set(key, {
        uses: prev.uses + 1,
        recognised: prev.recognised || item.recognised,
        timed: prev.timed || item.plannedDurationSec !== undefined,
        unilateral: prev.unilateral || item.unilateral === true,
      })
    }
  }

  const library = await listExercises(true)
  const out: NameResolution[] = []

  for (const [name, { uses, recognised, timed, unilateral }] of counts) {
    const existing = await findExerciseByName(name)
    if (existing) {
      out.push({ name, existing, uses, timed, unilateral, unreadable: false })
      continue
    }

    // Normalised equality catches "Barbell Back-Squat" vs "barbell back squat".
    const normalised = normalise(name)
    const sameNormalised = library.find((e) => normalise(e.name) === normalised)
    if (sameNormalised) {
      out.push({ name, existing: sameNormalised, uses, timed, unilateral, unreadable: false })
      continue
    }

    let best: Exercise | undefined
    let bestScore = 0
    for (const candidate of library) {
      const score = similarity(name, candidate.name)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    // 0.6 is high enough that "Bench Press" does not suggest "Leg Press".
    out.push({
      name,
      uses,
      timed,
      unilateral,
      suggestion: bestScore >= 0.6 ? best : undefined,
      unreadable: !recognised,
    })
  }

  // Unreadable lines first — they are the ones needing a decision.
  return out.sort(
    (a, b) =>
      Number(b.unreadable) - Number(a.unreadable) ||
      b.uses - a.uses ||
      a.name.localeCompare(b.name),
  )
}

/**
 * How a new exercise should be shaped, given what the routine said about it.
 *
 * Timed work gets duration and effort rather than weight and reps: an exercise
 * whose whole prescription is `3x30s` has nowhere to put the held duration
 * otherwise, which is why that column came back empty.
 */
function shapeOf(
  resolution: NameResolution,
  chosen: Equipment | undefined,
): { equipment: Equipment; fields?: LogField[]; isUnilateral?: boolean } {
  return {
    equipment: chosen ?? (resolution.timed ? 'bodyweight' : 'barbell'),
    fields: resolution.timed ? TIMED_FIELDS : undefined,
    isUnilateral: resolution.unilateral || undefined,
  }
}

export interface CommitResult {
  routineId: string
  /** 1 for a new routine, higher when it replaced one of the same name. */
  version: number
  created: number
  linked: number
  skipped: number
}

/**
 * Writes the routine. Names the user linked to an existing exercise are also
 * recorded as aliases, so the next import of the same file matches silently.
 */
export async function commitRoutine(
  parsed: ParsedRoutine,
  resolutions: NameResolution[],
  decisions: Map<string, Decision>,
  sourceRaw?: string,
): Promise<CommitResult> {
  const byName = new Map<string, string>()
  let created = 0
  let linked = 0
  let skipped = 0

  for (const resolution of resolutions) {
    const decision = decisions.get(resolution.name)

    // Left out of byName entirely, so every item using this name is dropped
    // below rather than creating an exercise nobody asked for.
    if (decision?.action === 'skip') {
      skipped++
      continue
    }

    if (resolution.existing && !decision) {
      byName.set(resolution.name, resolution.existing.id)
      linked++
      continue
    }

    if (decision?.action === 'link') {
      byName.set(resolution.name, decision.exerciseId)
      await addExerciseAlias(decision.exerciseId, resolution.name)
      linked++
      continue
    }

    if (decision?.action === 'rename') {
      const corrected = decision.name.trim()
      if (!corrected) {
        skipped++
        continue
      }
      // A corrected name often turns out to already exist — that is the whole
      // point of letting it be fixed here rather than after the fact.
      const match = await findExerciseByName(corrected)
      if (match) {
        byName.set(resolution.name, match.id)
        linked++
      } else {
        const made = await createExercise({
          name: corrected,
          ...shapeOf(resolution, decision.equipment),
        })
        byName.set(resolution.name, made.id)
        created++
      }
      continue
    }

    // An unreadable name reaching here without a decision would be exactly the
    // old bug. The preview defaults these to skip; this is the backstop.
    if (resolution.unreadable) {
      skipped++
      continue
    }

    const exercise = await createExercise({
      name: resolution.name,
      ...shapeOf(resolution, decision?.action === 'create' ? decision.equipment : undefined),
    })
    byName.set(resolution.name, exercise.id)
    created++
  }

  const routineId = newId()
  let version = 1

  // exercises is in scope so each item's written name can be compared against
  // the library entry it resolved to, for exercise_alias_of.
  await db.transaction(
    'rw',
    [db.routines, db.routineDays, db.routineItems, db.exercises],
    async () => {
      // Re-importing under the same name makes a new version rather than a second
      // routine with a duplicated name. The previous one is kept — sessions
      // logged against it must still resolve — but marked superseded so it drops
      // out of the routine list.
      const sameName = (await db.routines.where('name').equals(parsed.name).toArray()).filter(
        (r) => !r.supersededBy,
      )
      if (sameName.length > 0) {
        version = Math.max(...sameName.map((r) => r.version ?? 1)) + 1
        await Promise.all(
          sameName.map((r) => db.routines.update(r.id, { supersededBy: routineId })),
        )
      }

      await db.routines.add({
        id: routineId,
        name: parsed.name,
        version,
        source: parsed.source,
        sourceRaw,
        createdAt: nowIso(),
      })

      for (const [dayIndex, day] of parsed.days.entries()) {
        const dayId = newId()
        await db.routineDays.add({
          id: dayId,
          routineId,
          order: dayIndex,
          name: day.name,
        })

        for (const [itemIndex, item] of day.items.entries()) {
          const written = item.exercise.trim()
          const exerciseId = byName.get(written)
          if (!exerciseId) continue
          const matched = await db.exercises.get(exerciseId)
          await db.routineItems.add({
            id: newId(),
            routineDayId: dayId,
            order: itemIndex,
            exerciseId,
            plannedSets: item.plannedSets,
            plannedRepsMin: item.plannedRepsMin,
            plannedRepsMax: item.plannedRepsMax,
            plannedDurationSec: item.plannedDurationSec,
            // Only worth keeping when the file called it something else.
            sourceName: matched && matched.name !== written ? written : undefined,
            note: item.note,
          })
        }
      }
    },
  )

  return { routineId, version, created, linked, skipped }
}

export async function deleteRoutine(routineId: string): Promise<void> {
  await db.transaction('rw', [db.routines, db.routineDays, db.routineItems], async () => {
    const days = await db.routineDays.where('routineId').equals(routineId).toArray()
    for (const day of days) {
      const itemIds = await db.routineItems.where('routineDayId').equals(day.id).primaryKeys()
      await db.routineItems.bulkDelete(itemIds)
    }
    await db.routineDays.bulkDelete(days.map((d) => d.id))
    await db.routines.delete(routineId)
  })
}
