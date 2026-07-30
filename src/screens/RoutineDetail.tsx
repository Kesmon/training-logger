import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { IconChevron, IconTrash } from '../components/Icons'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { fmtDate } from '../core/format'
import { deleteRoutine } from '../core/import/apply'
import { startSessionFromRoutineDay } from '../db/queries'
import { db } from '../db/schema'
import { navigate } from '../router'

export function RoutineDetail({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)

  const data = useLiveQuery(async () => {
    const routine = await db.routines.get(id)
    if (!routine) return null
    const days = (await db.routineDays.where('routineId').equals(id).toArray()).sort(
      (a, b) => a.order - b.order,
    )
    const withItems = await Promise.all(
      days.map(async (day) => {
        const items = (await db.routineItems.where('routineDayId').equals(day.id).toArray()).sort(
          (a, b) => a.order - b.order,
        )
        const named = await Promise.all(
          items.map(async (item) => ({
            item,
            name: (await db.exercises.get(item.exerciseId))?.name ?? 'Deleted exercise',
          })),
        )
        return { day, items: named }
      }),
    )
    return { routine, days: withItems }
  }, [id])

  if (data === undefined) return <Screen title="Routine" onBack children={null} />
  if (data === null) {
    return (
      <Screen title="Routine" onBack>
        <p className="muted">This routine no longer exists.</p>
      </Screen>
    )
  }

  const { routine, days } = data

  async function start(dayId: string) {
    const session = await startSessionFromRoutineDay(dayId)
    if (session) navigate(`/session/${session.id}`)
  }

  async function remove() {
    await deleteRoutine(id)
    navigate('/library', { replace: true })
  }

  return (
    <>
      <Screen
        title={routine.name}
        onBack
        actions={
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => setConfirming(true)}
            aria-label="Delete routine"
          >
            <IconTrash />
          </button>
        }
      >
        <div className="stack-lg">
          <div className="section-title">
            {days.length} day{days.length === 1 ? '' : 's'} · imported{' '}
            {fmtDate(routine.createdAt.slice(0, 10))}
          </div>

          {days.map(({ day, items }) => (
            <div key={day.id} className="card">
              <div className="row" style={{ marginBottom: day.notes ? 4 : 8 }}>
                <div style={{ flex: 1, fontWeight: 620 }}>{day.name}</div>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={() => void start(day.id)}
                >
                  Start
                </button>
              </div>
              {day.notes && (
                <div className="daynote" style={{ marginBottom: 8 }}>
                  {day.notes}
                </div>
              )}
              <div className="stack" style={{ gap: 5 }}>
                {items.map(({ item, name }) => (
                  <div key={item.id} className="row small" style={{ gap: 8 }}>
                    <span className="faint num" style={{ width: 18 }}>
                      {item.order + 1}
                    </span>
                    <span style={{ flex: 1 }}>{name}</span>
                    <span className="faint num">{item.plannedSets} sets</span>
                  </div>
                ))}
                {items.some(({ item }) => item.note) && (
                  <div className="tiny faint" style={{ marginTop: 4 }}>
                    {items
                      .filter(({ item }) => item.note)
                      .map(({ item, name }) => `${name}: ${item.note}`)
                      .join(' · ')}
                  </div>
                )}
              </div>
            </div>
          ))}

          <button className="btn btn--block" onClick={() => navigate('/import')}>
            Import another routine
            <IconChevron />
          </button>
        </div>
      </Screen>

      {confirming && (
        <Sheet title={`Delete ${routine.name}?`} onClose={() => setConfirming(false)}>
          <div className="stack">
            <p className="small muted">
              The routine and its days are removed. Sessions you already logged from it are kept,
              along with every exercise it created.
            </p>
            <button className="btn btn--danger btn--lg btn--block" onClick={() => void remove()}>
              Delete routine
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
