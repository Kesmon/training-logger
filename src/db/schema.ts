import Dexie, { type Table } from 'dexie'

// IndexedDB cannot index booleans, so flags that appear in a `where` clause are
// stored as 0 | 1 rather than false | true.
export type Flag = 0 | 1

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'bodyweight_loaded'
  | 'assisted'
  | 'band'
  | 'other'

export type SetType =
  | 'working'
  | 'warmup'
  | 'top'
  | 'backoff'
  | 'drop'
  | 'amrap'
  | 'failure'
  | 'myorep'
  | 'restpause'

export type EffortType = 'rpe' | 'rir'

/**
 * What happened to a set.
 *
 * `planned` is a row that was laid out but never touched. Once its session is
 * finished it exports as `not_logged` — which is deliberately distinct from
 * `skipped`, because a decision to skip cannot be inferred from an untouched
 * row and has to be recorded as one.
 */
export type SetStatus = 'planned' | 'completed' | 'skipped'

/** Which inputs the logging screen renders for a given exercise. */
export type LogField = 'weight' | 'reps' | 'effort' | 'tempo' | 'time' | 'distance' | 'band'

export type Unit = 'kg' | 'lb'
export type E1rmFormula = 'epley' | 'brzycki'

export interface Exercise {
  id: string
  name: string
  /** Lower-cased `name`, indexed so import matching is case-insensitive. */
  nameLower: string
  /** Alternate spellings met during import; a multiEntry index. */
  aliases: string[]
  equipment: Equipment
  /** Empty-bar weight, so total load can include it. Barbells default to 20. */
  barWeightKg?: number
  /** Optional — only needed if you want per-muscle volume breakdowns. */
  primaryMuscles: string[]
  secondaryMuscles: string[]
  fields: LogField[]
  defaultEffortType: EffortType | null
  isArchived: Flag
  createdAt: string
  notes?: string
}

export interface Routine {
  id: string
  name: string
  source: 'csv' | 'text' | 'json' | 'manual'
  /** The original imported file, kept so a parser fix can be replayed. */
  sourceRaw?: string
  notes?: string
  createdAt: string
}

export interface RoutineDay {
  id: string
  routineId: string
  order: number
  name: string
  notes?: string
}

export interface RoutineItem {
  id: string
  routineDayId: string
  order: number
  exerciseId: string
  plannedSets: number
  /** Free text such as "5x3+ T1". Shown while lifting, never enforced. */
  note?: string
}

export interface Session {
  /** Local calendar date, YYYY-MM-DD. */
  id: string
  date: string
  startedAt: string
  endedAt?: string
  routineId?: string
  routineDayId?: string
  /** Snapshotted so history survives deleting the routine it came from. */
  routineName?: string
  dayName?: string
  bodyweightKg?: number
  sessionRpe?: number
  location?: string
  notes?: string
  isComplete: Flag
}

export interface SetEntry {
  id: string
  sessionId: string
  exerciseId: string
  /** Snapshotted for the same reason as Session.routineName. */
  exerciseName: string
  /** Denormalised session date, so charts and PR lookups avoid an N+1 join. */
  date: string
  /** Position of this exercise's block within the session. */
  order: number
  setNumber: number
  setType: SetType
  /** Negative means assistance, e.g. a -20 kg assisted pull-up. */
  weightKg?: number
  reps?: number
  effortType?: EffortType
  effortValue?: number
  /** Eccentric-pause-concentric-pause, e.g. "3-1-1-0". */
  tempo?: string
  timeSec?: number
  distanceM?: number
  bandColor?: string
  status: SetStatus
  /**
   * Mirrors `status === 'completed'`. Kept as a separate stored field only
   * because IndexedDB cannot index a string union usefully here and several
   * hot queries filter on it. Always written through `setSetStatus`.
   */
  isComplete: Flag
  loggedAt?: string
  notes?: string
}

export interface Settings {
  id: 'settings'
  unit: Unit
  defaultEffortType: EffortType | null
  e1rmFormula: E1rmFormula
  theme: 'system' | 'dark' | 'light'
  lastExportAt?: string
  sessionsSinceExport: number
  /** The greyed "last time: 137.5 x 5 @8" hint on the logging screen. */
  showLastTime: boolean
  /** Delimiter and decimal separator used when writing the CSV log. */
  csvFlavor: 'international' | 'european'
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  unit: 'kg',
  defaultEffortType: 'rpe',
  e1rmFormula: 'epley',
  theme: 'system',
  sessionsSinceExport: 0,
  showLastTime: true,
  csvFlavor: 'international',
}

export class TrainingDb extends Dexie {
  exercises!: Table<Exercise, string>
  routines!: Table<Routine, string>
  routineDays!: Table<RoutineDay, string>
  routineItems!: Table<RoutineItem, string>
  sessions!: Table<Session, string>
  setEntries!: Table<SetEntry, string>
  settings!: Table<Settings, string>

  constructor(name = 'training-logger') {
    super(name)
    this.version(1).stores({
      exercises: 'id, nameLower, *aliases, isArchived, equipment',
      routines: 'id, name, createdAt',
      routineDays: 'id, routineId, [routineId+order]',
      routineItems: 'id, routineDayId, [routineDayId+order]',
      sessions: 'id, date, startedAt, isComplete, routineDayId',
      setEntries: 'id, sessionId, exerciseId, [sessionId+order], [exerciseId+date]',
      settings: 'id',
    })

    // v2 introduces `status`. Existing rows only ever had two states, since
    // anything unticked was deleted at session finish.
    this.version(2).upgrade((tx) =>
      tx
        .table<SetEntry>('setEntries')
        .toCollection()
        .modify((set) => {
          set.status = set.isComplete ? 'completed' : 'planned'
        }),
    )
  }
}

export const db = new TrainingDb()
