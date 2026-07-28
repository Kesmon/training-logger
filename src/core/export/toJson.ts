import { db, DEFAULT_SETTINGS, type Settings } from '../../db/schema'
import { getSettings } from '../../db/queries'
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportBundle } from './types'

export async function buildBundle(): Promise<ExportBundle> {
  const [settings, exercises, routines, routineDays, routineItems, sessions, setEntries] =
    await Promise.all([
      getSettings(),
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineDays.toArray(),
      db.routineItems.toArray(),
      db.sessions.toArray(),
      db.setEntries.toArray(),
    ])

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    exercises,
    routines,
    routineDays,
    routineItems,
    sessions,
    setEntries,
  }
}

export async function bundleToJson(): Promise<string> {
  return JSON.stringify(await buildBundle(), null, 2)
}

export class BundleError extends Error {}

/** Parses and sanity-checks a backup file without touching the database. */
export function parseBundle(text: string): ExportBundle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BundleError('That file is not valid JSON.')
  }

  if (typeof raw !== 'object' || raw === null) throw new BundleError('Unexpected file contents.')
  const b = raw as Partial<ExportBundle>

  if (b.format !== EXPORT_FORMAT) {
    throw new BundleError('That is not a Training Logger backup file.')
  }
  if (typeof b.version !== 'number' || b.version > EXPORT_VERSION) {
    throw new BundleError(
      `This backup was written by a newer version of the app (v${String(b.version)}). Update first, then import.`,
    )
  }

  const tables = [
    'exercises',
    'routines',
    'routineDays',
    'routineItems',
    'sessions',
    'setEntries',
  ] as const
  for (const t of tables) {
    if (!Array.isArray(b[t])) throw new BundleError(`Backup is missing its "${t}" section.`)
  }

  return {
    format: EXPORT_FORMAT,
    version: b.version,
    exportedAt: b.exportedAt ?? new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, ...(b.settings ?? {}), id: 'settings' } as Settings,
    exercises: b.exercises!,
    routines: b.routines!,
    routineDays: b.routineDays!,
    routineItems: b.routineItems!,
    sessions: b.sessions!,
    setEntries: b.setEntries!,
  }
}

export interface RestoreSummary {
  exercises: number
  routines: number
  sessions: number
  sets: number
}

/**
 * Writes a bundle into the database.
 *
 * 'replace' wipes first — the true restore, and what the round-trip test uses.
 * 'merge' keeps existing rows and adds anything whose id is new, for pulling
 * one device's history into another.
 */
export async function restoreBundle(
  bundle: ExportBundle,
  mode: 'replace' | 'merge' = 'replace',
): Promise<RestoreSummary> {
  await db.transaction(
    'rw',
    [
      db.exercises,
      db.routines,
      db.routineDays,
      db.routineItems,
      db.sessions,
      db.setEntries,
      db.settings,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.exercises.clear(),
          db.routines.clear(),
          db.routineDays.clear(),
          db.routineItems.clear(),
          db.sessions.clear(),
          db.setEntries.clear(),
        ])
        await db.settings.put(bundle.settings)
      }

      // bulkPut is an upsert, so 'merge' overwrites same-id rows with the
      // incoming version rather than failing on a key collision.
      await db.exercises.bulkPut(bundle.exercises)
      await db.routines.bulkPut(bundle.routines)
      await db.routineDays.bulkPut(bundle.routineDays)
      await db.routineItems.bulkPut(bundle.routineItems)
      await db.sessions.bulkPut(bundle.sessions)
      await db.setEntries.bulkPut(bundle.setEntries)
    },
  )

  return {
    exercises: bundle.exercises.length,
    routines: bundle.routines.length,
    sessions: bundle.sessions.length,
    sets: bundle.setEntries.length,
  }
}
