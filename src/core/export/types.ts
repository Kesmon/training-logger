import type {
  Exercise,
  Routine,
  RoutineDay,
  RoutineItem,
  Session,
  SetEntry,
  Settings,
} from '../../db/schema'

export const EXPORT_FORMAT = 'training-logger'
export const EXPORT_VERSION = 1

/**
 * The full on-device database in one file. This is the backup: re-importing it
 * must reproduce an identical database, which the round-trip test asserts.
 */
export interface ExportBundle {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  settings: Settings
  exercises: Exercise[]
  routines: Routine[]
  routineDays: RoutineDay[]
  routineItems: RoutineItem[]
  sessions: Session[]
  setEntries: SetEntry[]
}

/** How numbers and columns are written, so the CSV opens cleanly in Excel. */
export type CsvFlavor = 'international' | 'european'

export interface CsvStyle {
  delimiter: string
  decimal: string
}

export function csvStyle(flavor: CsvFlavor): CsvStyle {
  // Excel in a comma-decimal locale (Norwegian, German, French…) splits on ';'
  // and reads ',' as the decimal point. Getting this wrong turns the whole
  // export into a single unusable column.
  return flavor === 'european'
    ? { delimiter: ';', decimal: ',' }
    : { delimiter: ',', decimal: '.' }
}
