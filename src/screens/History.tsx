import { useLiveQuery } from 'dexie-react-hooks'
import { IconChevron } from '../components/Icons'
import { Empty, Screen } from '../components/Screen'
import { fmtDate, fmtDayName, fmtDuration, sessionDuration, trimNum } from '../core/format'
import { sessionVolume } from '../core/metrics'
import { listSessions } from '../db/queries'
import { db } from '../db/schema'
import { Link } from '../router'

export function History() {
  const rows = useLiveQuery(
    async () => {
      const sessions = (await listSessions()).filter((s) => s.isComplete)
      return Promise.all(
        sessions.map(async (session) => {
          const sets = await db.setEntries.where('sessionId').equals(session.id).toArray()
          return {
            session,
            sets: sets.filter((s) => s.isComplete).length,
            volume: sessionVolume(sets),
            exercises: new Set(sets.map((s) => s.exerciseName)).size,
          }
        }),
      )
    },
    [],
    [],
  )

  if (rows.length === 0) {
    return (
      <Screen title="History">
        <Empty title="Nothing logged yet">
          Finished sessions appear here, newest first.
        </Empty>
      </Screen>
    )
  }

  // Group by month so long histories stay scannable.
  const groups = new Map<string, (typeof rows)[number][]>()
  for (const row of rows) {
    const [y, m] = row.session.date.split('-')
    const key = `${y}-${m}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  return (
    <Screen title="History">
      <div className="stack-lg">
        {[...groups.entries()].map(([key, items]) => {
          const [y, m] = key.split('-').map(Number)
          const label = new Date(y!, m! - 1, 1).toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })
          return (
            <div key={key}>
              <div className="section-title">
                {label} · {items.length} session{items.length === 1 ? '' : 's'}
              </div>
              <div className="stack">
                {items.map(({ session, sets, volume, exercises }) => {
                  const dur = sessionDuration(session.startedAt, session.endedAt)
                  return (
                    <Link key={session.id} to={`/history/${session.id}`} className="listitem">
                      <div className="listitem__body">
                        <div className="listitem__title">
                          {session.dayName ?? `${fmtDayName(session.date)} session`}
                        </div>
                        <div className="tiny faint num">
                          {fmtDate(session.date)} · {exercises} exercise
                          {exercises === 1 ? '' : 's'} · {sets} set{sets === 1 ? '' : 's'}
                          {volume > 0 ? ` · ${trimNum(Math.round(volume))} kg` : ''}
                          {dur ? ` · ${fmtDuration(dur)}` : ''}
                        </div>
                      </div>
                      <IconChevron className="chevron" />
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Screen>
  )
}
