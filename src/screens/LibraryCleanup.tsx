import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Empty, Screen } from '../components/Screen'
import { equipmentLabel } from '../core/format'
import { findLibraryIssues } from '../core/library/duplicates'
import { mergeExercises, updateExercise } from '../db/queries'
import { db } from '../db/schema'

/**
 * Puts history back together after the importer created exercises from lines it
 * could not read. Every merge is shown with the number of sets that will move,
 * and nothing happens without a tap — this is the one operation in the app that
 * rewrites logged history, so it does not run on its own.
 */
export function LibraryCleanup() {
  const [done, setDone] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const exercises = await db.exercises.toArray()
    const usage = new Map<string, number>()
    for (const e of exercises) {
      usage.set(e.id, await db.setEntries.where('exerciseId').equals(e.id).count())
    }
    return { issues: findLibraryIssues(exercises, usage), usage }
  }, [])

  if (!data) return <Screen title="Clean up library" onBack children={null} />

  const { issues, usage } = data
  const sets = (n: number) => `${n} set${n === 1 ? '' : 's'}`
  const nothingToDo = issues.merges.length === 0 && issues.renames.length === 0

  async function merge(fromId: string, intoId: string, label: string) {
    setBusy(fromId)
    try {
      const moved = await mergeExercises(fromId, intoId)
      setDone((d) => [...d, `${label} — ${moved} set${moved === 1 ? '' : 's'} moved`])
    } finally {
      setBusy(null)
    }
  }

  async function rename(id: string, name: string) {
    setBusy(id)
    try {
      await updateExercise(id, { name })
      setDone((d) => [...d, `Renamed to ${name}`])
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen title="Clean up library" onBack>
      <div className="stack-lg">
        {done.length > 0 && (
          <div className="card small callout--ok">
            {done.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>
        )}

        {nothingToDo ? (
          <Empty title="Nothing to clean up">
            No duplicate or malformed exercise names found. Your library is tidy.
          </Empty>
        ) : (
          <p className="small muted">
            These look like the same movement recorded under different names,
            usually because an imported line didn’t parse. Merging moves every logged set onto
            the entry you keep and remembers the old name, so future imports match it.
          </p>
        )}

        {issues.merges.length > 0 && (
          <div>
            <div className="section-title">
              {issues.merges.length} possible duplicate
              {issues.merges.length === 1 ? '' : 's'}
            </div>
            <div className="stack">
              {issues.merges.map((candidate) => (
                <div className="card" key={candidate.canonical.id}>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tiny faint">Keep</div>
                      <div style={{ fontWeight: 620 }}>{candidate.canonical.name}</div>
                      <div className="tiny faint">
                        {equipmentLabel(candidate.canonical.equipment)} ·{' '}
                        {sets(usage.get(candidate.canonical.id) ?? 0)}
                      </div>
                    </div>
                  </div>

                  {candidate.duplicates.map((dup) => (
                    <div
                      key={dup.id}
                      className="row"
                      style={{ gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <code className="tiny" style={{ wordBreak: 'break-all' }}>
                          {dup.name}
                        </code>
                        <div className="tiny faint">
                          {sets(usage.get(dup.id) ?? 0)} would move
                        </div>
                      </div>
                      <button
                        className="btn btn--sm btn--primary"
                        disabled={busy !== null}
                        onClick={() =>
                          void merge(dup.id, candidate.canonical.id, candidate.canonical.name)
                        }
                      >
                        {busy === dup.id ? '…' : 'Merge'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {issues.renames.length > 0 && (
          <div>
            <div className="section-title">
              {issues.renames.length} name{issues.renames.length === 1 ? '' : 's'} to tidy
            </div>
            <div className="stack">
              {issues.renames.map(({ exercise, suggested }) => (
                <div className="card row" key={exercise.id} style={{ gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <code className="tiny" style={{ wordBreak: 'break-all' }}>
                      {exercise.name}
                    </code>
                    <div className="small" style={{ fontWeight: 560 }}>
                      → {suggested}
                    </div>
                  </div>
                  <button
                    className="btn btn--sm"
                    disabled={busy !== null}
                    onClick={() => void rename(exercise.id, suggested)}
                  >
                    Rename
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  )
}
