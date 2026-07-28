import { newId, nowIso } from '../ids'
import {
  addExerciseAlias,
  createExercise,
  findExerciseByName,
  listExercises,
} from '../../db/queries'
import { db, type Equipment, type Exercise } from '../../db/schema'
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
}

export type Decision =
  | { action: 'link'; exerciseId: string }
  | { action: 'create'; equipment: Equipment }

/** All distinct exercise names in a routine, each matched where possible. */
export async function resolveNames(parsed: ParsedRoutine): Promise<NameResolution[]> {
  const counts = new Map<string, number>()
  for (const day of parsed.days) {
    for (const item of day.items) {
      const key = item.exercise.trim()
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const library = await listExercises(true)
  const out: NameResolution[] = []

  for (const [name, uses] of counts) {
    const existing = await findExerciseByName(name)
    if (existing) {
      out.push({ name, existing, uses })
      continue
    }

    // Normalised equality catches "Barbell Back-Squat" vs "barbell back squat".
    const normalised = normalise(name)
    const sameNormalised = library.find((e) => normalise(e.name) === normalised)
    if (sameNormalised) {
      out.push({ name, existing: sameNormalised, uses })
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
    out.push({ name, uses, suggestion: bestScore >= 0.6 ? best : undefined })
  }

  return out.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
}

export interface CommitResult {
  routineId: string
  created: number
  linked: number
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

  for (const resolution of resolutions) {
    const decision = decisions.get(resolution.name)

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

    const exercise = await createExercise({
      name: resolution.name,
      equipment: decision?.action === 'create' ? decision.equipment : 'barbell',
    })
    byName.set(resolution.name, exercise.id)
    created++
  }

  const routineId = newId()
  await db.transaction('rw', [db.routines, db.routineDays, db.routineItems], async () => {
    await db.routines.add({
      id: routineId,
      name: parsed.name,
      source: parsed.source,
      sourceRaw,
      createdAt: nowIso(),
    })

    for (const [dayIndex, day] of parsed.days.entries()) {
      const dayId = newId()
      await db.routineDays.add({ id: dayId, routineId, order: dayIndex, name: day.name })

      for (const [itemIndex, item] of day.items.entries()) {
        const exerciseId = byName.get(item.exercise.trim())
        if (!exerciseId) continue
        await db.routineItems.add({
          id: newId(),
          routineDayId: dayId,
          order: itemIndex,
          exerciseId,
          plannedSets: item.plannedSets,
          note: item.note,
        })
      }
    }
  })

  return { routineId, created, linked }
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
