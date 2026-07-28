import type { Session } from '../../db/schema'

/**
 * Deterministic, never-reused export filenames.
 *
 * The index is the session's position among that day's sessions, so a second
 * session on the same date is `-S2` rather than overwriting the first. Two
 * exports of the same session produce the same name, which is what makes a
 * re-send replace rather than duplicate.
 */
export function sessionFilename(session: Session, sameDay: Session[], ext = 'csv'): string {
  const ordered = [...sameDay]
    .filter((s) => s.date === session.date)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))

  const index = ordered.findIndex((s) => s.id === session.id)
  const suffix = index >= 0 ? `-S${index + 1}` : ''
  return `training-log-${session.date}${suffix}.${ext}`
}

/** The whole-history file, for when the coach wants everything at once. */
export function allSessionsFilename(today: string, ext = 'csv'): string {
  return `training-log-all-${today}.${ext}`
}
