import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { IconChevron, IconTrash } from '../components/Icons'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { fmtAgo, fmtDate } from '../core/format'
import { deleteRoutine } from '../core/import/apply'
import { describeChange } from '../core/import/diffRoutines'
import {
  deleteRoutineSource,
  getActiveSession,
  getRoutineSourceFor,
  startSessionFromRoutineDay,
  updateRoutineSource,
} from '../db/queries'
import { db } from '../db/schema'
import { applyPendingSource, checkRoutineSource, type UpdateOutcome } from '../sync/updateRoutine'
import { navigate } from '../router'

export function RoutineDetail({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null)

  const data = useLiveQuery(async () => {
    const routine = await db.routines.get(id)
    if (!routine) return null
    const source = await getRoutineSourceFor(id)
    const active = await getActiveSession()
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
    return { routine, source, active, days: withItems }
  }, [id])

  if (data === undefined) return <Screen title="Routine" onBack children={null} />
  if (data === null) {
    return (
      <Screen title="Routine" onBack>
        <p className="muted">This routine no longer exists.</p>
      </Screen>
    )
  }

  const { routine, source, active, days } = data

  async function start(dayId: string) {
    const session = await startSessionFromRoutineDay(dayId)
    if (session) navigate(`/session/${session.id}`)
  }

  async function remove() {
    await deleteRoutine(id)
    navigate('/library', { replace: true })
  }

  /** An applied update supersedes this routine, so the screen has to follow it. */
  function follow(result: UpdateOutcome) {
    setOutcome(result)
    if (result.kind === 'applied' && result.routineId !== id) {
      navigate(`/routine/${result.routineId}`, { replace: true })
    }
  }

  async function checkNow() {
    if (!source) return
    setChecking(true)
    try {
      follow(await checkRoutineSource(source, { force: true }))
    } finally {
      setChecking(false)
    }
  }

  async function acceptHeld(name: string) {
    if (!source) return
    setChecking(true)
    try {
      follow(
        await applyPendingSource(source, new Map([[name, { action: 'create', equipment: 'other' }]])),
      )
    } finally {
      setChecking(false)
    }
  }

  async function applyWaiting() {
    if (!source) return
    setChecking(true)
    try {
      follow(await applyPendingSource(source))
    } finally {
      setChecking(false)
    }
  }

  async function dismissPending() {
    if (!source) return
    await updateRoutineSource(source.id, {
      pendingRaw: undefined,
      pendingHash: undefined,
      pendingNames: undefined,
    })
    setOutcome(null)
  }

  const held = source?.pendingNames ?? []
  /**
   * Pending text with nothing held back is a whole update waiting to land —
   * but only offered while no session is running, because during one the honest
   * answer is "this applies when you are done", and an Apply button beside that
   * sentence contradicts it.
   */
  const waiting = !!source?.pendingRaw && held.length === 0 && !active

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
            {days.length} day{days.length === 1 ? '' : 's'} · v{routine.version} · imported{' '}
            {fmtDate(routine.createdAt.slice(0, 10))}
          </div>

          {source && (
            <div className="card small stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>Following your coach’s link</div>
                  <div className="tiny faint">
                    {source.lastError
                      ? source.lastError
                      : `Checked ${fmtAgo(source.lastCheckedAt)} · applied ${fmtAgo(source.lastAppliedAt)}`}
                  </div>
                </div>
                <button
                  className="btn btn--sm"
                  disabled={checking}
                  onClick={() => void checkNow()}
                >
                  {checking ? '…' : 'Check now'}
                </button>
              </div>

              {/* What the last check did. Shown only right after one, because a
                  routine that rewrites itself silently is unsettling — seeing
                  the change named is what makes it trustworthy. */}
              {outcome?.kind === 'applied' && outcome.changes.length > 0 && (
                <div className="stack" style={{ gap: 2 }}>
                  <div className="tiny" style={{ color: 'var(--ok)' }}>
                    Updated to v{outcome.version}
                  </div>
                  {outcome.changes.map((c, i) => (
                    <div key={i} className="tiny faint">
                      {describeChange(c)}
                    </div>
                  ))}
                </div>
              )}
              {outcome?.kind === 'unchanged' && (
                <div className="tiny faint">No changes — your routine is up to date.</div>
              )}
              {outcome?.kind === 'cosmetic' && (
                <div className="tiny faint">The sheet was re-saved, but nothing changed.</div>
              )}
              {outcome?.kind === 'rate-limited' && (
                <div className="tiny faint">Checked very recently — try again in a minute.</div>
              )}
              {/* Shown whenever something is held back by a running session,
                  not only right after a check — it is the reason the routine on
                  screen is not the one in the sheet. */}
              {(outcome?.kind === 'deferred' || (active && !!source.pendingRaw)) && (
                <div className="tiny faint">
                  An update is waiting. It will apply once you finish the session in progress.
                </div>
              )}

              {waiting && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="tiny">An update from your coach is waiting.</div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={checking}
                      onClick={() => void applyWaiting()}
                    >
                      Apply it
                    </button>
                    <button className="btn btn--sm" onClick={() => void dismissPending()}>
                      Not now
                    </button>
                  </div>
                </div>
              )}

              {/* The one thing auto-update will never do by itself. Creating an
                  exercise from a line nobody read is how junk gets into the
                  library permanently, so it is always a deliberate tap. */}
              {held.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="tiny" style={{ color: 'var(--pr)' }}>
                    Your coach added {held.length === 1 ? 'an exercise' : 'exercises'} not in your
                    library. The rest of the routine is up to date.
                  </div>
                  {held.map((name) => (
                    <div key={name} className="row" style={{ gap: 8 }}>
                      <span style={{ flex: 1 }}>{name}</span>
                      <button
                        className="btn btn--sm btn--primary"
                        disabled={checking}
                        onClick={() => void acceptHeld(name)}
                      >
                        Add it
                      </button>
                    </div>
                  ))}
                  <button className="btn btn--sm" onClick={() => void dismissPending()}>
                    Ignore for now
                  </button>
                </div>
              )}

              <button
                className="btn btn--sm"
                onClick={() => void deleteRoutineSource(source.id)}
              >
                Stop following the link
              </button>
            </div>
          )}

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
