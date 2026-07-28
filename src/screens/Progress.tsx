import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { IconChevron, IconTrophy } from '../components/Icons'
import { Empty, Screen } from '../components/Screen'
import { fmtDate, fmtWeight, trimNum, weekStart } from '../core/format'
import {
  estimate1rmFromSet,
  hardSetsPerMuscle,
  runningPrs,
  volumeLoad,
} from '../core/metrics'
import { useChartTheme } from '../hooks/useResolvedTheme'
import { useSettings } from '../hooks/useSettings'
import { db, type Exercise, type SetEntry } from '../db/schema'
import { Link } from '../router'

const WEEKS = 12

export function Progress({ exerciseId }: { exerciseId?: string }) {
  return exerciseId ? <ExerciseProgress id={exerciseId} /> : <Overview />
}

// ------------------------------------------------------------------ overview

function Overview() {
  const settings = useSettings()
  const chart = useChartTheme()

  const data = useLiveQuery(async () => {
    const sets = (await db.setEntries.toArray()).filter((s) => s.isComplete)
    const exercises = await db.exercises.toArray()
    const byId = new Map(exercises.map((e) => [e.id, e]))

    // Weekly volume, oldest first, gaps filled so the axis is evenly spaced.
    const volumes = new Map<string, number>()
    for (const set of sets) {
      const week = weekStart(set.date)
      volumes.set(week, (volumes.get(week) ?? 0) + volumeLoad(set))
    }
    const weeks: { week: string; volume: number }[] = []
    if (volumes.size > 0) {
      const cursor = new Date(weekStart(new Date().toISOString().slice(0, 10)))
      for (let i = WEEKS - 1; i >= 0; i--) {
        const d = new Date(cursor)
        d.setDate(d.getDate() - i * 7)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`
        weeks.push({ week: key, volume: Math.round(volumes.get(key) ?? 0) })
      }
    }

    // Hard sets per muscle over the trailing 7 days.
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const sinceKey = since.toISOString().slice(0, 10)
    const muscles = hardSetsPerMuscle(
      sets.filter((s) => s.date >= sinceKey),
      byId,
    )
    const taggedCount = exercises.filter((e) => e.primaryMuscles.length > 0).length

    // Recent records, newest first.
    const prs: { set: SetEntry; kinds: string[] }[] = []
    const byExercise = new Map<string, SetEntry[]>()
    for (const set of sets) {
      if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, [])
      byExercise.get(set.exerciseId)!.push(set)
    }
    for (const history of byExercise.values()) {
      history.sort((a, b) => (a.loggedAt ?? a.date).localeCompare(b.loggedAt ?? b.date))
      for (const { set, prs: flags } of runningPrs(history, settings.e1rmFormula)) {
        if (!flags.any) continue
        const kinds = [
          flags.weight ? 'Weight' : null,
          flags.reps ? 'Reps' : null,
          flags.e1rm ? 'e1RM' : null,
        ].filter((x): x is string => x !== null)
        prs.push({ set, kinds })
      }
    }
    prs.sort((a, b) => (b.set.loggedAt ?? b.set.date).localeCompare(a.set.loggedAt ?? a.set.date))

    const logged = exercises
      .filter((e) => byExercise.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { weeks, muscles, taggedCount, prs: prs.slice(0, 10), logged, total: sets.length }
  }, [settings.e1rmFormula])

  if (!data) return <Screen title="Progress" children={null} />

  if (data.total === 0) {
    return (
      <Screen title="Progress">
        <Empty title="Nothing to chart yet">
          Log a few sessions and your volume, records and estimated 1RMs will show up here.
        </Empty>
      </Screen>
    )
  }

  const latestWeek = data.weeks[data.weeks.length - 1]
  const muscleRows = Object.entries(data.muscles).sort((a, b) => b[1] - a[1])
  const maxMuscle = muscleRows[0]?.[1] ?? 1

  return (
    <Screen title="Progress">
      <div className="stack-lg">
        <section>
          <div className="row" style={{ alignItems: 'baseline', marginBottom: 2 }}>
            <div className="section-title" style={{ flex: 1, marginBottom: 0 }}>
              Weekly volume · kg
            </div>
            <div className="num" style={{ fontWeight: 650 }}>
              {latestWeek ? trimNum(latestWeek.volume) : '0'}
            </div>
          </div>
          <p className="tiny faint" style={{ marginBottom: 8 }}>
            This week, and the {WEEKS - 1} before it
          </p>
          <div className="card" style={{ padding: '12px 6px 4px 0' }}>
            <ResponsiveContainer width="100%" height={168}>
              <BarChart data={data.weeks} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={chart.grid} strokeWidth={1} />
                <XAxis
                  dataKey="week"
                  tickFormatter={(w: string) => fmtDate(w).replace(/ \d{4}$/, '')}
                  tick={{ fill: chart.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis
                  tick={{ fill: chart.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  cursor={{ fill: chart.grid, fillOpacity: 0.45 }}
                  content={<ChartTip unit="kg" labelFormat={(w) => `Week of ${fmtDate(w)}`} />}
                />
                {/* Capped bar width leaves air in each band; 4px rounded cap,
                    square at the baseline. */}
                <Bar dataKey="volume" fill={chart.mark} maxBarSize={24} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <div className="section-title">Hard sets by muscle · last 7 days</div>
          {muscleRows.length === 0 ? (
            <p className="small faint">
              {data.taggedCount === 0
                ? 'Tag exercises with muscles in Library to see this breakdown. It is optional — nothing else depends on it.'
                : 'No working sets logged in the last 7 days.'}
            </p>
          ) : (
            <div className="card stack" style={{ gap: 7 }}>
              {muscleRows.map(([muscle, count]) => (
                <div key={muscle} className="row" style={{ gap: 10 }}>
                  <span className="small" style={{ width: 88, flex: 'none' }}>
                    {muscle}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 4,
                      background: chart.grid,
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${(count / maxMuscle) * 100}%`,
                        background: chart.mark,
                        borderRadius: 4,
                      }}
                    />
                  </span>
                  <span className="small num faint" style={{ width: 26, textAlign: 'right' }}>
                    {trimNum(count, 1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {data.prs.length > 0 && (
          <section>
            <div className="section-title">Recent records</div>
            <div className="stack" style={{ gap: 6 }}>
              {data.prs.map(({ set, kinds }) => (
                <div key={set.id} className="card row" style={{ padding: '9px 12px', gap: 10 }}>
                  <IconTrophy className="chevron" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small listitem__title">{set.exerciseName}</div>
                    <div className="tiny faint num">
                      {fmtWeight(set.weightKg, settings.unit)} × {set.reps} · {fmtDate(set.date)}
                    </div>
                  </div>
                  <span className="badge badge--pr">{kinds.join(' + ')}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="section-title">By exercise</div>
          <div className="stack">
            {data.logged.map((e) => (
              <Link key={e.id} to={`/progress/${e.id}`} className="listitem">
                <div className="listitem__body">
                  <div className="listitem__title">{e.name}</div>
                </div>
                <IconChevron className="chevron" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Screen>
  )
}

// -------------------------------------------------------------- per exercise

function ExerciseProgress({ id }: { id: string }) {
  const settings = useSettings()
  const chart = useChartTheme()

  const data = useLiveQuery(async () => {
    const exercise = await db.exercises.get(id)
    if (!exercise) return null
    const history = (await db.setEntries.where('exerciseId').equals(id).toArray())
      .filter((s) => s.isComplete && s.setType !== 'warmup')
      .sort((a, b) => (a.loggedAt ?? a.date).localeCompare(b.loggedAt ?? b.date))

    // One point per session: that session's best estimate and heaviest set.
    const bySession = new Map<string, { date: string; e1rm: number; top: number }>()
    for (const set of history) {
      const e1rm = estimate1rmFromSet(set, settings.e1rmFormula) ?? 0
      const existing = bySession.get(set.sessionId)
      if (!existing) {
        bySession.set(set.sessionId, { date: set.date, e1rm, top: set.weightKg ?? 0 })
      } else {
        existing.e1rm = Math.max(existing.e1rm, e1rm)
        existing.top = Math.max(existing.top, set.weightKg ?? 0)
      }
    }
    const points = [...bySession.values()]
      .filter((p) => p.e1rm > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({ date: p.date, e1rm: Math.round(p.e1rm * 10) / 10, top: p.top }))

    return { exercise, history, points }
  }, [id, settings.e1rmFormula])

  if (data === undefined) return <Screen title="Progress" onBack children={null} />
  if (data === null) {
    return (
      <Screen title="Progress" onBack>
        <p className="muted">This exercise no longer exists.</p>
      </Screen>
    )
  }

  const { exercise, history, points } = data as {
    exercise: Exercise
    history: SetEntry[]
    points: { date: string; e1rm: number; top: number }[]
  }

  const best1rm = points.reduce((m, p) => Math.max(m, p.e1rm), 0)
  const bestWeight = history.reduce((m, s) => Math.max(m, s.weightKg ?? 0), 0)
  const sessions = new Set(history.map((s) => s.sessionId)).size
  const heaviest = [...history]
    .sort(
      (a, b) =>
        (b.weightKg ?? 0) - (a.weightKg ?? 0) ||
        (b.reps ?? 0) - (a.reps ?? 0),
    )
    .slice(0, 8)

  return (
    <Screen title={exercise.name} onBack>
      <div className="stack-lg">
        <div className="statgrid">
          <div className="stat">
            <div className="stat__v">{fmtWeight(bestWeight, settings.unit) || '–'}</div>
            <div className="stat__k">Best {settings.unit}</div>
          </div>
          <div className="stat">
            <div className="stat__v">{best1rm ? trimNum(Math.round(best1rm)) : '–'}</div>
            <div className="stat__k">Best e1RM</div>
          </div>
          <div className="stat">
            <div className="stat__v">{sessions}</div>
            <div className="stat__k">Sessions</div>
          </div>
        </div>

        {points.length < 2 ? (
          <p className="small faint">
            One more session and this will start charting. Estimated 1RM uses the RPE chart when a
            set has an effort rating, and {settings.e1rmFormula === 'epley' ? 'Epley' : 'Brzycki'}{' '}
            otherwise.
          </p>
        ) : (
          <section>
            <div className="section-title">Estimated 1RM · kg</div>
            <div className="card" style={{ padding: '12px 8px 4px 0' }}>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={points} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={chart.grid} strokeWidth={1} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => fmtDate(d).replace(/ \d{4}$/, '')}
                    tick={{ fill: chart.axis, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={22}
                  />
                  <YAxis
                    tick={{ fill: chart.axis, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    domain={['dataMin - 5', 'dataMax + 5']}
                  />
                  <Tooltip
                    cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                    content={<ChartTip unit="kg" labelFormat={fmtDate} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke={chart.mark}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    // Surface ring keeps dots legible where the line crosses them.
                    dot={
                      points.length <= 24
                        ? { r: 4, fill: chart.mark, stroke: chart.surface, strokeWidth: 2 }
                        : false
                    }
                    activeDot={{ r: 5, fill: chart.mark, stroke: chart.surface, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        <section>
          <div className="section-title">Heaviest sets</div>
          <div className="card stack" style={{ gap: 5 }}>
            {heaviest.map((s) => (
              <div key={s.id} className="row small num">
                <span className="faint" style={{ width: 64 }}>
                  {fmtDate(s.date)}
                </span>
                <span style={{ flex: 1, fontWeight: 550 }}>
                  {fmtWeight(s.weightKg, settings.unit)} × {s.reps ?? '–'}
                </span>
                <span className="faint">
                  {trimNum(Math.round(estimate1rmFromSet(s, settings.e1rmFormula) ?? 0)) || '–'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Screen>
  )
}

// ------------------------------------------------------------------ tooltip

interface TipProps {
  active?: boolean
  payload?: { value: number; dataKey: string }[]
  label?: string
  unit: string
  labelFormat: (label: string) => string
}

function ChartTip({ active, payload, label, unit, labelFormat }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--surface-3)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        padding: '7px 10px',
        boxShadow: '0 6px 20px rgb(0 0 0 / 0.35)',
      }}
    >
      <div className="tiny faint">{label ? labelFormat(label) : ''}</div>
      <div className="num" style={{ fontWeight: 650 }}>
        {trimNum(payload[0]!.value)} {unit}
      </div>
    </div>
  )
}
