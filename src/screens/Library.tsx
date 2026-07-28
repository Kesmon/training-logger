import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ExercisePicker } from '../components/ExercisePicker'
import { IconChevron, IconPlus } from '../components/Icons'
import { Empty, Screen } from '../components/Screen'
import { equipmentLabel, fmtDate } from '../core/format'
import { listExercises } from '../db/queries'
import { db } from '../db/schema'
import { Link, navigate } from '../router'

export function Library() {
  const [tab, setTab] = useState<'exercises' | 'routines'>('exercises')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const exercises = useLiveQuery(() => listExercises(), [], [])
  const routines = useLiveQuery(
    async () => {
      const all = await db.routines.orderBy('createdAt').reverse().toArray()
      return Promise.all(
        all.map(async (routine) => ({
          routine,
          days: await db.routineDays.where('routineId').equals(routine.id).count(),
        })),
      )
    },
    [],
    [],
  )

  const key = query.trim().toLowerCase()
  const shown = exercises.filter(
    (e) => !key || e.nameLower.includes(key) || e.aliases.some((a) => a.includes(key)),
  )

  return (
    <>
      <Screen title="Library">
        <div className="stack-lg">
          <div className="segmented" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'exercises'}
              className={tab === 'exercises' ? 'on' : ''}
              onClick={() => setTab('exercises')}
            >
              Exercises
            </button>
            <button
              role="tab"
              aria-selected={tab === 'routines'}
              className={tab === 'routines' ? 'on' : ''}
              onClick={() => setTab('routines')}
            >
              Routines
            </button>
          </div>

          {tab === 'exercises' ? (
            <div className="stack">
              {exercises.length > 0 && (
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search exercises"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              )}

              <button className="btn btn--primary btn--block" onClick={() => setAdding(true)}>
                <IconPlus /> New exercise
              </button>

              {exercises.length === 0 ? (
                <Empty title="No exercises yet">
                  They are created as you log or import them — nothing to set up in advance.
                </Empty>
              ) : (
                shown.map((e) => (
                  <Link key={e.id} to={`/exercise/${e.id}`} className="listitem">
                    <div className="listitem__body">
                      <div className="listitem__title">{e.name}</div>
                      <div className="tiny faint">
                        {equipmentLabel(e.equipment)}
                        {e.primaryMuscles.length > 0 && ` · ${e.primaryMuscles.join(', ')}`}
                      </div>
                    </div>
                    <IconChevron className="chevron" />
                  </Link>
                ))
              )}
            </div>
          ) : (
            <div className="stack">
              <button className="btn btn--primary btn--block" onClick={() => navigate('/import')}>
                <IconPlus /> Import routine
              </button>

              {routines.length === 0 ? (
                <Empty title="No routines yet">
                  Import a CSV or a Markdown list of exercises to lay out your training days.
                </Empty>
              ) : (
                routines.map(({ routine, days }) => (
                  <Link key={routine.id} to={`/routine/${routine.id}`} className="listitem">
                    <div className="listitem__body">
                      <div className="listitem__title">{routine.name}</div>
                      <div className="tiny faint">
                        {days} day{days === 1 ? '' : 's'} · imported{' '}
                        {fmtDate(routine.createdAt.slice(0, 10))}
                      </div>
                    </div>
                    <IconChevron className="chevron" />
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </Screen>

      {adding && (
        <ExercisePicker
          onClose={() => setAdding(false)}
          onPick={(exercise) => {
            setAdding(false)
            navigate(`/exercise/${exercise.id}`)
          }}
        />
      )}
    </>
  )
}
