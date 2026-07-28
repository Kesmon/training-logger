import { useLiveQuery } from 'dexie-react-hooks'
import { Empty, Screen } from '../components/Screen'
import { IconChevron, IconPlus } from '../components/Icons'
import { fmtDate, fmtDayName, fmtDuration, sessionDuration } from '../core/format'
import { getActiveSession, listSessions, startSession } from '../db/queries'
import { db } from '../db/schema'
import { Link, navigate } from '../router'

export function Today() {
  const active = useLiveQuery(getActiveSession, [])
  const recent = useLiveQuery(() => listSessions(8), [], [])
  const routineDays = useLiveQuery(
    async () => {
      const routines = await db.routines.toArray()
      const days = await db.routineDays.toArray()
      return days
        .sort((a, b) => a.order - b.order)
        .map((d) => ({ day: d, routine: routines.find((r) => r.id === d.routineId) }))
        .filter((x) => x.routine)
    },
    [],
    [],
  )

  const completed = (recent ?? []).filter((s) => s.isComplete)

  async function begin() {
    const session = await startSession()
    navigate(`/session/${session.id}`)
  }

  async function beginFromDay(dayId: string) {
    const day = await db.routineDays.get(dayId)
    if (!day) return
    const routine = await db.routines.get(day.routineId)
    const session = await startSession({
      routineDayId: day.id,
      routineId: day.routineId,
      routineName: routine?.name,
      dayName: day.name,
    })
    navigate(`/session/${session.id}`)
  }

  const today = new Date()

  return (
    <Screen title="Today">
      <div className="stack-lg">
        <div>
          <div className="section-title">
            {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>

          {active ? (
            <Link to={`/session/${active.id}`} className="card" style={{ display: 'block' }}>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 620, fontSize: 17 }}>Session in progress</div>
                  <div className="small muted">
                    {active.dayName ?? 'Empty session'}
                    {active.routineName ? ` · ${active.routineName}` : ''}
                  </div>
                </div>
                <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  Resume
                </span>
              </div>
            </Link>
          ) : (
            <button className="btn btn--primary btn--lg btn--block" onClick={() => void begin()}>
              <IconPlus /> Start empty session
            </button>
          )}
        </div>

        {!active && routineDays.length > 0 && (
          <div>
            <div className="section-title">Start from a routine</div>
            <div className="stack">
              {routineDays.map(({ day, routine }) => (
                <button
                  key={day.id}
                  className="listitem"
                  onClick={() => void beginFromDay(day.id)}
                >
                  <div className="listitem__body">
                    <div className="listitem__title">{day.name}</div>
                    <div className="tiny faint">{routine!.name}</div>
                  </div>
                  <IconChevron className="chevron" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="section-title">Recent</div>
          {completed.length === 0 ? (
            <Empty title="No sessions yet">
              Start a session above, or import a routine from Settings.
            </Empty>
          ) : (
            <div className="stack">
              {completed.map((s) => {
                const dur = sessionDuration(s.startedAt, s.endedAt)
                return (
                  <Link key={s.id} to={`/history/${s.id}`} className="listitem">
                    <div className="listitem__body">
                      <div className="listitem__title">
                        {s.dayName ?? `${fmtDayName(s.date)} session`}
                      </div>
                      <div className="tiny faint">
                        {fmtDate(s.date)}
                        {dur ? ` · ${fmtDuration(dur)}` : ''}
                        {s.routineName ? ` · ${s.routineName}` : ''}
                      </div>
                    </div>
                    <IconChevron className="chevron" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Screen>
  )
}
