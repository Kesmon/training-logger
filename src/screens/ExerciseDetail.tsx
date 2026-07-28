import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { IconTrash } from '../components/Icons'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import {
  EQUIPMENT,
  MUSCLES,
  equipmentLabel,
  fmtDate,
  fmtWeight,
  trimNum,
} from '../core/format'
import { estimate1rmFromSet } from '../core/metrics'
import { useSettings } from '../hooks/useSettings'
import {
  defaultFieldsFor,
  getExerciseHistory,
  removeExercise,
  updateExercise,
} from '../db/queries'
import { db, type Equipment, type LogField } from '../db/schema'
import { Link, navigate } from '../router'

const OPTIONAL_FIELDS: { key: LogField; label: string; hint: string }[] = [
  { key: 'effort', label: 'Effort', hint: 'RPE or reps in reserve' },
  { key: 'tempo', label: 'Tempo', hint: 'e.g. 3-1-1-0' },
  { key: 'time', label: 'Time', hint: 'holds, carries, planks' },
  { key: 'distance', label: 'Distance', hint: 'sled, farmer’s walk' },
  { key: 'band', label: 'Band', hint: 'band colour' },
]

export function ExerciseDetail({ id }: { id: string }) {
  const settings = useSettings()
  const [confirming, setConfirming] = useState(false)

  const data = useLiveQuery(async () => {
    const exercise = await db.exercises.get(id)
    if (!exercise) return null
    return { exercise, history: await getExerciseHistory(id) }
  }, [id])

  if (data === undefined) return <Screen title="Exercise" onBack children={null} />
  if (data === null) {
    return (
      <Screen title="Exercise" onBack>
        <p className="muted">This exercise no longer exists.</p>
      </Screen>
    )
  }

  const { exercise, history } = data
  const working = history.filter((s) => s.setType !== 'warmup')
  const bestWeight = working.length ? Math.max(...working.map((s) => s.weightKg ?? 0)) : 0
  const best1rm = working.reduce(
    (max, s) => Math.max(max, estimate1rmFromSet(s, settings.e1rmFormula) ?? 0),
    0,
  )
  const sessions = new Set(working.map((s) => s.sessionId)).size

  function toggleMuscle(muscle: string, list: 'primaryMuscles' | 'secondaryMuscles') {
    const current = exercise![list]
    const next = current.includes(muscle)
      ? current.filter((m) => m !== muscle)
      : [...current, muscle]
    void updateExercise(id, { [list]: next })
  }

  function toggleField(field: LogField) {
    const next = exercise!.fields.includes(field)
      ? exercise!.fields.filter((f) => f !== field)
      : [...exercise!.fields, field]
    void updateExercise(id, { fields: next })
  }

  async function remove() {
    const result = await removeExercise(id)
    setConfirming(false)
    if (result === 'deleted') navigate('/library', { replace: true })
  }

  return (
    <>
      <Screen
        title={exercise.name}
        onBack
        actions={
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => setConfirming(true)}
            aria-label="Delete exercise"
          >
            <IconTrash />
          </button>
        }
      >
        <div className="stack-lg">
          {exercise.isArchived === 1 && (
            <div className="card small muted">
              Archived — hidden from pickers, but its history is intact.{' '}
              <button
                className="btn btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => void updateExercise(id, { isArchived: 0 })}
              >
                Restore
              </button>
            </div>
          )}

          {working.length > 0 && (
            <div className="statgrid">
              <div className="stat">
                <div className="stat__v num">{fmtWeight(bestWeight, settings.unit) || '–'}</div>
                <div className="stat__k">Best {settings.unit}</div>
              </div>
              <div className="stat">
                <div className="stat__v num">
                  {best1rm ? trimNum(Math.round(best1rm)) : '–'}
                </div>
                <div className="stat__k">Best e1RM</div>
              </div>
              <div className="stat">
                <div className="stat__v num">{sessions}</div>
                <div className="stat__k">Sessions</div>
              </div>
            </div>
          )}

          <div>
            <div className="fieldlabel">Name</div>
            <input
              value={exercise.name}
              autoCapitalize="words"
              onChange={(e) => void updateExercise(id, { name: e.target.value })}
            />
          </div>

          <div>
            <div className="fieldlabel">Equipment</div>
            <div className="chips">
              {EQUIPMENT.map((eq) => (
                <button
                  key={eq}
                  className={`chip chip--sm${exercise.equipment === eq ? ' chip--on' : ''}`}
                  onClick={() =>
                    void updateExercise(id, {
                      equipment: eq as Equipment,
                      // Keep any optional extras the user has turned on.
                      fields: [
                        ...new Set([
                          ...defaultFieldsFor(eq),
                          ...exercise.fields.filter((f) =>
                            (['tempo', 'time', 'distance'] as LogField[]).includes(f),
                          ),
                        ]),
                      ],
                    })
                  }
                >
                  {equipmentLabel(eq)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="fieldlabel">Fields to log</div>
            <div className="chips">
              {OPTIONAL_FIELDS.map(({ key, label, hint }) => (
                <button
                  key={key}
                  className={`chip chip--sm${exercise.fields.includes(key) ? ' chip--on' : ''}`}
                  onClick={() => toggleField(key)}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              Weight and reps follow the equipment type. Turn extras on only where you use them —
              the logging row stays uncluttered.
            </p>
          </div>

          <div>
            <div className="fieldlabel">Primary muscles</div>
            <div className="chips">
              {MUSCLES.map((m) => (
                <button
                  key={m}
                  className={`chip chip--sm${exercise.primaryMuscles.includes(m) ? ' chip--on' : ''}`}
                  onClick={() => toggleMuscle(m, 'primaryMuscles')}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              Optional — only needed for the per-muscle volume breakdown on Progress.
            </p>
          </div>

          <div>
            <div className="fieldlabel">Secondary muscles</div>
            <div className="chips">
              {MUSCLES.map((m) => (
                <button
                  key={m}
                  className={`chip chip--sm${
                    exercise.secondaryMuscles.includes(m) ? ' chip--on' : ''
                  }`}
                  onClick={() => toggleMuscle(m, 'secondaryMuscles')}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {exercise.aliases.length > 0 && (
            <div>
              <div className="fieldlabel">Also imported as</div>
              <p className="small muted">{exercise.aliases.join(', ')}</p>
            </div>
          )}

          {working.length > 0 && (
            <div>
              <div className="fieldlabel">Recent</div>
              <div className="stack" style={{ gap: 4 }}>
                {[...working]
                  .reverse()
                  .slice(0, 12)
                  .map((s) => (
                    <div key={s.id} className="row small num">
                      <span className="faint" style={{ width: 62 }}>
                        {fmtDate(s.date)}
                      </span>
                      <span style={{ flex: 1 }}>
                        {fmtWeight(s.weightKg, settings.unit)} × {s.reps ?? '–'}
                      </span>
                    </div>
                  ))}
              </div>
              <Link
                to={`/progress/${id}`}
                className="btn btn--sm btn--ghost btn--block"
                style={{ marginTop: 10 }}
              >
                View progress chart
              </Link>
            </div>
          )}
        </div>
      </Screen>

      {confirming && (
        <Sheet title={`Delete ${exercise.name}?`} onClose={() => setConfirming(false)}>
          <div className="stack">
            <p className="small muted">
              {working.length > 0
                ? `This exercise has ${working.length} logged sets, so it will be archived instead of deleted — the history stays intact and it disappears from pickers.`
                : 'This exercise has no logged sets and will be deleted outright.'}
            </p>
            <button className="btn btn--danger btn--lg btn--block" onClick={() => void remove()}>
              {working.length > 0 ? 'Archive exercise' : 'Delete exercise'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
