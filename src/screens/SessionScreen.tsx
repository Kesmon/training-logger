import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ExercisePicker } from '../components/ExercisePicker'
import { IconPlus, IconTrash } from '../components/Icons'
import { Screen } from '../components/Screen'
import { NumberField } from '../components/NumberField'
import { SetRow } from '../components/SetRow'
import { Sheet } from '../components/Sheet'
import {
  fmtDate,
  fmtDuration,
  fmtEffort,
  fmtWeight,
  kgToDisplay,
  displayToKg,
  trimNum,
} from '../core/format'
import { lastTimeSets, runningPrs, sessionVolume, type PrFlags } from '../core/metrics'
import { useSettings } from '../hooks/useSettings'
import {
  addSet,
  setSetStatus,
  deleteSet,
  finishSession,
  getExerciseHistory,
  getSessionSets,
  removeExerciseFromSession,
  saveSettings,
  updateSession,
  updateSet,
} from '../db/queries'
import { db, type Exercise, type SetEntry } from '../db/schema'
import { bundleToCsv, UTF8_BOM } from '../core/export/toCsv'
import { buildBundle, narrowToSessions } from '../core/export/toJson'
import { sessionFilename } from '../core/export/filename'
import { deliverFile } from '../platform/share'
import { navigate } from '../router'

export function SessionScreen({ id }: { id: string }) {
  const settings = useSettings()
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [finished, setFinished] = useState(false)
  const [sending, setSending] = useState(false)

  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(id)
    if (!session) return null

    const sets = await getSessionSets(id)
    const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))]
    const exercises = new Map<string, Exercise>()
    const histories = new Map<string, SetEntry[]>()
    const prs = new Map<string, PrFlags>()

    for (const exId of exerciseIds) {
      const ex = await db.exercises.get(exId)
      if (ex) exercises.set(exId, ex)

      const all = await getExerciseHistory(exId)
      // "Last time" means the previous session, so today is excluded here.
      histories.set(
        exId,
        all.filter((s) => s.sessionId !== id),
      )
      // Records, though, must see earlier sets from today too — otherwise a
      // second heavier set in the same workout never counts as a record.
      for (const { set, prs: flags } of runningPrs(all, settings.e1rmFormula)) {
        prs.set(set.id, flags)
      }
    }
    return { session, sets, exercises, histories, prs }
  }, [id, settings.e1rmFormula])

  if (data === undefined) return <Screen title="Session" hideNav children={null} />
  if (data === null) {
    return (
      <Screen title="Session" onBack hideNav>
        <p className="muted">This session no longer exists.</p>
      </Screen>
    )
  }

  const { session, sets, exercises, histories, prs } = data

  // Sets carry the order of their exercise's block within the session.
  const blocks = [...new Set(sets.map((s) => s.exerciseId))]
    .map((exId) => ({
      exercise: exercises.get(exId),
      sets: sets.filter((s) => s.exerciseId === exId).sort((a, b) => a.setNumber - b.setNumber),
    }))
    .filter((b): b is { exercise: Exercise; sets: SetEntry[] } => !!b.exercise)
    .sort((a, b) => (a.sets[0]?.order ?? 0) - (b.sets[0]?.order ?? 0))

  const done = sets.filter((s) => s.isComplete)
  const skipped = sets.filter((s) => s.status === 'skipped')
  const untouched = sets.filter((s) => s.status === 'planned')
  const volume = sessionVolume(sets)
  const elapsed = (Date.now() - new Date(session.startedAt).getTime()) / 1000

  async function onFinish() {
    await finishSession(id)
    // Deliberately not navigating away yet: the export is offered here, while
    // the phone is already in hand. Anything that has to be remembered later,
    // after training, does not reliably happen.
    setFinished(true)
  }

  async function sendToCoach() {
    setSending(true)
    try {
      const bundle = await buildBundle()
      const sameDay = bundle.sessions.filter((s) => s.date === session.date)
      const csv = bundleToCsv(narrowToSessions(bundle, [id]), settings.csvFlavor)
      await deliverFile(sessionFilename(session, sameDay), UTF8_BOM + csv, 'text/csv')
      await saveSettings({ lastExportAt: new Date().toISOString(), sessionsSinceExport: 0 })
    } finally {
      setSending(false)
      navigate(`/history/${id}`, { replace: true })
    }
  }

  return (
    <>
      <Screen
        title={session.dayName ?? fmtDate(session.date)}
        onBack={() => navigate('/')}
        hideNav
        actions={
          <button className="btn btn--sm btn--primary" onClick={() => setConfirming(true)}>
            Finish
          </button>
        }
      >
        <div className="main--session stack-lg" style={{ padding: 0 }}>
          <div className="statgrid">
            <div className="stat">
              <div className="stat__v num">{done.length}</div>
              <div className="stat__k">Sets</div>
            </div>
            <div className="stat">
              <div className="stat__v num">{trimNum(Math.round(volume))}</div>
              <div className="stat__k">Volume {settings.unit === 'lb' ? 'lb' : 'kg'}</div>
            </div>
            <div className="stat">
              <div className="stat__v num">{fmtDuration(elapsed)}</div>
              <div className="stat__k">Elapsed</div>
            </div>
          </div>

          {blocks.length === 0 && (
            <p className="small faint" style={{ textAlign: 'center', padding: '28px 12px' }}>
              No exercises yet — add your first one below.
            </p>
          )}

          {blocks.map(({ exercise, sets: exSets }) => {
            const history = histories.get(exercise.id) ?? []
            const previous = settings.showLastTime ? lastTimeSets(history, id) : []
            return (
              <div className="exblock" key={exercise.id}>
                <div className="exblock__head">
                  <div className="exblock__name">{exercise.name}</div>
                  {exercise.isUnilateral && <span className="badge">per side</span>}
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => void removeExerciseFromSession(id, exercise.id)}
                    aria-label={`Remove ${exercise.name}`}
                  >
                    <IconTrash />
                  </button>
                </div>

                {previous.length > 0 && (
                  <div className="exblock__hint">
                    last time · {fmtDate(previous[0]!.date)} ·{' '}
                    {previous
                      .slice(0, 4)
                      .map(
                        (s) =>
                          `${fmtWeight(s.weightKg, settings.unit)}×${s.reps ?? '–'}${
                            s.effortValue !== undefined
                              ? ' ' + fmtEffort(s.effortType ?? 'rpe', s.effortValue)
                              : ''
                          }`,
                      )
                      .join('  ')}
                    {previous.length > 4 ? ' …' : ''}
                  </div>
                )}

                <div className="exblock__sets">
                  {exSets.map((s) => (
                    <SetRow
                      key={s.id}
                      set={s}
                      exercise={exercise}
                      settings={settings}
                      prs={prs.get(s.id)}
                      onChange={(patch) => void updateSet(s.id, patch)}
                      onStatus={(status) => void setSetStatus(s.id, status)}
                      onDelete={() => void deleteSet(s.id)}
                    />
                  ))}
                </div>

                <div className="exblock__foot">
                  <button
                    className="btn btn--sm btn--ghost btn--block"
                    onClick={() => void addSet(id, exercise)}
                  >
                    <IconPlus /> Add set
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Screen>

      <div className="sessionbar">
        <button className="btn btn--block btn--lg" onClick={() => setPicking(true)}>
          <IconPlus /> Add exercise
        </button>
      </div>

      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={async (exercise) => {
            setPicking(false)
            await addSet(id, exercise)
          }}
        />
      )}

      {confirming && finished && (
        <Sheet title="Session saved" onClose={() => navigate(`/history/${id}`, { replace: true })}>
          <div className="stack">
            <p className="small muted">
              {done.length} set{done.length === 1 ? '' : 's'} logged
              {skipped.length > 0 && `, ${skipped.length} skipped`}
              {untouched.length > 0 && `, ${untouched.length} not logged`}.
            </p>
            <button
              className="btn btn--primary btn--lg btn--block"
              disabled={sending}
              onClick={() => void sendToCoach()}
            >
              {sending ? 'Preparing…' : 'Send to coach'}
            </button>
            <p className="tiny faint">
              Exports just this session as {sessionFilename(session, [session])}. Saving it to the
              same folder each time keeps it to a couple of taps.
            </p>
            <button
              className="btn btn--block"
              onClick={() => navigate(`/history/${id}`, { replace: true })}
            >
              Not now
            </button>
          </div>
        </Sheet>
      )}

      {confirming && !finished && (
        <Sheet title="Finish session" onClose={() => setConfirming(false)}>
          <div className="stack">
            <div className="statgrid">
              <div className="stat">
                <div className="stat__v num">{done.length}</div>
                <div className="stat__k">Sets</div>
              </div>
              <div className="stat">
                <div className="stat__v num">{trimNum(Math.round(volume))}</div>
                <div className="stat__k">Volume kg</div>
              </div>
              <div className="stat">
                <div className="stat__v num">{fmtDuration(elapsed)}</div>
                <div className="stat__k">Duration</div>
              </div>
            </div>
            {skipped.length > 0 && (
              <p className="small muted">
                {skipped.length} set{skipped.length === 1 ? '' : 's'} marked skipped.
              </p>
            )}
            {untouched.length > 0 && (
              <p className="small muted">
                {untouched.length} set{untouched.length === 1 ? '' : 's'} never logged. These are
                kept and recorded as not logged — use <strong>Skip set</strong> on a row if you
                decided against it, which is a different thing.
              </p>
            )}

            {/* Captured here because it is the only moment the whole session is
                in view, and because one tap at the end is worth more than most
                of the per-set detail. */}
            <div>
              <div className="fieldlabel">How hard was the session?</div>
              <div className="chips">
                {[5, 6, 7, 8, 9, 10].map((v) => (
                  <button
                    key={v}
                    className={`chip${session.sessionRpe === v ? ' chip--on' : ''}`}
                    onClick={() =>
                      void updateSession(id, {
                        sessionRpe: session.sessionRpe === v ? undefined : v,
                      })
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="fieldlabel">Bodyweight ({settings.unit})</div>
                <NumberField
                  value={
                    session.bodyweightKg === undefined
                      ? undefined
                      : kgToDisplay(session.bodyweightKg, settings.unit)
                  }
                  onChange={(v) =>
                    void updateSession(id, {
                      bodyweightKg: v === undefined ? undefined : displayToKg(v, settings.unit),
                    })
                  }
                  decimal
                  min={0}
                />
              </div>
            </div>

            <div>
              <div className="fieldlabel">Session note</div>
              <input
                value={session.notes ?? ''}
                placeholder="Left knee felt off…"
                onChange={(e) => void updateSession(id, { notes: e.target.value || undefined })}
              />
            </div>
            <button className="btn btn--primary btn--lg btn--block" onClick={() => void onFinish()}>
              Finish session
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
