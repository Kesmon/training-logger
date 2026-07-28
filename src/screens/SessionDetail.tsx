import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { IconTrash } from '../components/Icons'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import {
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtEffort,
  fmtWeight,
  sessionDuration,
  setTypeShort,
  trimNum,
} from '../core/format'
import { loggedGaps, sessionVolume } from '../core/metrics'
import { useSettings } from '../hooks/useSettings'
import { deleteSession, getSessionSets } from '../db/queries'
import { db } from '../db/schema'
import { navigate } from '../router'

export function SessionDetail({ id }: { id: string }) {
  const settings = useSettings()
  const [confirming, setConfirming] = useState(false)

  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(id)
    if (!session) return null
    return { session, sets: await getSessionSets(id) }
  }, [id])

  if (data === undefined) return <Screen title="Session" onBack children={null} />
  if (data === null) {
    return (
      <Screen title="Session" onBack>
        <p className="muted">This session no longer exists.</p>
      </Screen>
    )
  }

  const { session, sets } = data
  const duration = sessionDuration(session.startedAt, session.endedAt)
  const rests = loggedGaps(sets)
  const blocks = [...new Set(sets.map((s) => s.exerciseId))]
    .map((exId) => sets.filter((s) => s.exerciseId === exId))
    .sort((a, b) => (a[0]?.order ?? 0) - (b[0]?.order ?? 0))

  async function remove() {
    await deleteSession(id)
    navigate('/history', { replace: true })
  }

  return (
    <>
      <Screen
        title={session.dayName ?? fmtDate(session.date)}
        onBack
        actions={
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => setConfirming(true)}
            aria-label="Delete session"
          >
            <IconTrash />
          </button>
        }
      >
        <div className="stack-lg">
          <div>
            <div className="section-title">
              {fmtDate(session.date)}
              {session.routineName ? ` · ${session.routineName}` : ''}
            </div>
            <div className="statgrid">
              <div className="stat">
                <div className="stat__v num">{sets.length}</div>
                <div className="stat__k">Sets</div>
              </div>
              <div className="stat">
                <div className="stat__v num">{trimNum(Math.round(sessionVolume(sets)))}</div>
                <div className="stat__k">Volume kg</div>
              </div>
              <div className="stat">
                <div className="stat__v num">{duration ? fmtDuration(duration) : '–'}</div>
                <div className="stat__k">Duration</div>
              </div>
            </div>
          </div>

          {session.notes && <div className="card small">{session.notes}</div>}

          {blocks.map((exSets) => (
            <div className="card" key={exSets[0]!.exerciseId}>
              <div style={{ fontWeight: 620, marginBottom: 8 }}>{exSets[0]!.exerciseName}</div>
              <div className="stack" style={{ gap: 4 }}>
                {exSets.map((s) => {
                  const rest = rests.get(s.id)
                  const tag = setTypeShort(s.setType)
                  return (
                    <div key={s.id} className="row small num" style={{ gap: 8 }}>
                      <span
                        className="faint"
                        style={{ width: 34, flex: 'none', fontSize: tag ? 10 : 13 }}
                      >
                        {tag || s.setNumber}
                      </span>
                      <span style={{ flex: 1, fontWeight: 550 }}>
                        {s.weightKg !== undefined && `${fmtWeight(s.weightKg, settings.unit)} × `}
                        {s.reps ?? (s.timeSec !== undefined ? `${s.timeSec}s` : '–')}
                        {s.effortValue !== undefined && (
                          <span className="muted">
                            {' '}
                            {fmtEffort(s.effortType ?? 'rpe', s.effortValue)}
                          </span>
                        )}
                        {s.tempo && <span className="faint"> · {s.tempo}</span>}
                      </span>
                      {rest !== undefined && (
                        <span className="tiny faint" title="Rest before this set">
                          {fmtClock(rest)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {exSets.some((s) => s.notes) && (
                <div className="tiny faint" style={{ marginTop: 8 }}>
                  {exSets
                    .filter((s) => s.notes)
                    .map((s) => s.notes)
                    .join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </Screen>

      {confirming && (
        <Sheet title="Delete session?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p className="small muted">
              This removes the session and all {sets.length} of its sets. It cannot be undone.
            </p>
            <button className="btn btn--danger btn--lg btn--block" onClick={() => void remove()}>
              Delete session
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
