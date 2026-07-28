import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { UTF8_BOM, bundleToCsv } from '../core/export/toCsv'
import { BundleError, bundleToJson, buildBundle, parseBundle, restoreBundle } from '../core/export/toJson'
import { findLibraryIssues } from '../core/library/duplicates'
import { deliverFile, pickTextFile, todayStamp } from '../platform/share'
import { useSettings } from '../hooks/useSettings'
import { saveSettings } from '../db/queries'
import { db } from '../db/schema'
import { navigate } from '../router'

type Busy = null | 'json' | 'csv' | 'restore'

export function SettingsScreen() {
  const settings = useSettings()
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingWipe, setPendingWipe] = useState(false)

  const counts = useLiveQuery(async () => {
    const exercises = await db.exercises.toArray()
    const issues = findLibraryIssues(exercises)
    return {
      sessions: await db.sessions.where('isComplete').equals(1).count(),
      sets: await db.setEntries.count(),
      exercises: exercises.length,
      libraryIssues: issues.merges.length + issues.renames.length,
    }
  }, [])

  async function exportJson() {
    setBusy('json')
    setError(null)
    try {
      const json = await bundleToJson()
      const how = await deliverFile(`training-log-${todayStamp()}.json`, json, 'application/json')
      await saveSettings({ lastExportAt: new Date().toISOString(), sessionsSinceExport: 0 })
      setMessage(how === 'shared' ? 'Backup shared.' : 'Backup downloaded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  async function exportCsv() {
    setBusy('csv')
    setError(null)
    try {
      const bundle = await buildBundle()
      const csv = bundleToCsv(bundle, settings.csvFlavor)
      // The BOM is what makes Excel on Windows read this as UTF-8 rather than
      // the ANSI codepage — without it "Markløft" arrives as "MarklÃ¸ft".
      // Written as an escape, not a literal, so it survives editors and diffs.
      const how = await deliverFile(`training-log-${todayStamp()}.csv`, UTF8_BOM + csv, 'text/csv')
      await saveSettings({ lastExportAt: new Date().toISOString(), sessionsSinceExport: 0 })
      setMessage(how === 'shared' ? 'CSV shared.' : 'CSV downloaded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  async function restore(mode: 'replace' | 'merge') {
    setBusy('restore')
    setError(null)
    try {
      const file = await pickTextFile('application/json,.json')
      if (!file) return
      const summary = await restoreBundle(parseBundle(file.text), mode)
      setMessage(
        `Restored ${summary.sessions} sessions, ${summary.sets} sets, ${summary.exercises} exercises.`,
      )
    } catch (e) {
      setError(e instanceof BundleError || e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(null)
      setPendingWipe(false)
    }
  }

  async function wipe() {
    await db.transaction(
      'rw',
      [db.exercises, db.routines, db.routineDays, db.routineItems, db.sessions, db.setEntries],
      async () => {
        await Promise.all([
          db.exercises.clear(),
          db.routines.clear(),
          db.routineDays.clear(),
          db.routineItems.clear(),
          db.sessions.clear(),
          db.setEntries.clear(),
        ])
      },
    )
    setPendingWipe(false)
    setMessage('All training data deleted.')
  }

  const nudge = settings.sessionsSinceExport >= 5

  return (
    <>
      <Screen title="Settings">
        <div className="stack-lg">
          <div>
            <div className="section-title">Units &amp; effort</div>
            <div className="stack">
              <Row label="Weight unit">
                <Choice
                  value={settings.unit}
                  options={[
                    ['kg', 'kg'],
                    ['lb', 'lb'],
                  ]}
                  onChange={(unit) => void saveSettings({ unit })}
                />
              </Row>
              <Row label="Default effort scale" hint="RPE counts up to 10; RIR counts down to 0.">
                <Choice
                  value={settings.defaultEffortType ?? 'rpe'}
                  options={[
                    ['rpe', 'RPE'],
                    ['rir', 'RIR'],
                  ]}
                  onChange={(defaultEffortType) => void saveSettings({ defaultEffortType })}
                />
              </Row>
              <Row
                label="1RM formula"
                hint="Used when a set has no RPE. With an RPE, the standard chart is used instead — it is more accurate."
              >
                <Choice
                  value={settings.e1rmFormula}
                  options={[
                    ['epley', 'Epley'],
                    ['brzycki', 'Brzycki'],
                  ]}
                  onChange={(e1rmFormula) => void saveSettings({ e1rmFormula })}
                />
              </Row>
            </div>
          </div>

          <div>
            <div className="section-title">Appearance</div>
            <div className="stack">
              <Row label="Theme">
                <Choice
                  value={settings.theme}
                  options={[
                    ['system', 'Auto'],
                    ['dark', 'Dark'],
                    ['light', 'Light'],
                  ]}
                  onChange={(theme) => void saveSettings({ theme })}
                />
              </Row>
              <Row
                label="Show last session"
                hint="A greyed line on each exercise showing what you did last time."
              >
                <Choice
                  value={settings.showLastTime ? 'on' : 'off'}
                  options={[
                    ['on', 'On'],
                    ['off', 'Off'],
                  ]}
                  onChange={(v) => void saveSettings({ showLastTime: v === 'on' })}
                />
              </Row>
            </div>
          </div>

          <div>
            <div className="section-title">Data</div>
            <div className="stack">
              {counts && (
                <div className="statgrid">
                  <div className="stat">
                    <div className="stat__v num">{counts.sessions}</div>
                    <div className="stat__k">Sessions</div>
                  </div>
                  <div className="stat">
                    <div className="stat__v num">{counts.sets}</div>
                    <div className="stat__k">Sets</div>
                  </div>
                  <div className="stat">
                    <div className="stat__v num">{counts.exercises}</div>
                    <div className="stat__k">Exercises</div>
                  </div>
                </div>
              )}

              {nudge && (
                <div
                  className="card small"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--pr) 40%, var(--border))',
                    background: 'color-mix(in srgb, var(--pr) 8%, transparent)',
                  }}
                >
                  {settings.sessionsSinceExport} sessions since your last backup. Everything lives
                  on this phone only — export a copy.
                </div>
              )}

              <button
                className="btn btn--primary btn--block"
                disabled={busy !== null}
                onClick={() => void exportJson()}
              >
                {busy === 'json' ? 'Preparing…' : 'Export backup (JSON)'}
              </button>
              <p className="tiny faint">
                The complete database, and the only format that restores exactly. Save it to Files
                or iCloud Drive.
              </p>

              <button
                className="btn btn--block"
                disabled={busy !== null}
                onClick={() => void exportCsv()}
              >
                {busy === 'csv' ? 'Preparing…' : 'Export log (CSV)'}
              </button>
              <p className="tiny faint">
                One row per set, with volume, estimated 1RM and rest time already worked out.
              </p>

              <Row
                label="Spreadsheet format"
                hint="European uses ; between columns and , for decimals — what Excel expects in a Norwegian locale."
              >
                <Choice
                  value={settings.csvFlavor}
                  options={[
                    ['international', 'a, b'],
                    ['european', 'a; b'],
                  ]}
                  onChange={(csvFlavor) => void saveSettings({ csvFlavor })}
                />
              </Row>

              <div className="divider" />

              <button
                className="btn btn--block"
                disabled={busy !== null}
                onClick={() => navigate('/library/cleanup')}
              >
                Clean up exercise library
                {!!counts?.libraryIssues && (
                  <span className="badge" style={{ background: 'var(--warn)', color: '#fff' }}>
                    {counts.libraryIssues}
                  </span>
                )}
              </button>
              <p className="tiny faint">
                Merges duplicate or malformed exercise names and moves their logged sets onto the
                entry you keep.
              </p>

              <button
                className="btn btn--block"
                disabled={busy !== null}
                onClick={() => navigate('/import')}
              >
                Import a routine
              </button>
              <button
                className="btn btn--block"
                disabled={busy !== null}
                onClick={() => void restore('merge')}
              >
                {busy === 'restore' ? 'Reading…' : 'Merge a backup'}
              </button>
              <button
                className="btn btn--block btn--danger"
                disabled={busy !== null}
                onClick={() => setPendingWipe(true)}
              >
                Restore or erase…
              </button>

              {settings.lastExportAt && (
                <p className="tiny faint">
                  Last export {new Date(settings.lastExportAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="section-title">About storage</div>
            <p className="small muted">
              Your training data is stored on this device only — nothing is uploaded anywhere. iOS
              can clear a website’s storage after about a week of disuse, but apps added to the
              home screen are exempt from that. Export a backup now and then anyway.
            </p>
          </div>
        </div>
      </Screen>

      {message && (
        <div className="toast" role="status">
          <span style={{ flex: 1 }}>{message}</span>
          <button className="btn btn--sm btn--ghost" onClick={() => setMessage(null)}>
            OK
          </button>
        </div>
      )}
      {error && (
        <div className="toast" role="alert" style={{ borderColor: 'var(--warn)' }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn btn--sm btn--ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {pendingWipe && (
        <Sheet title="Restore or erase" onClose={() => setPendingWipe(false)}>
          <div className="stack">
            <p className="small muted">
              Restoring replaces everything currently on this device with the contents of a backup
              file. Erasing deletes your training data outright. Neither can be undone.
            </p>
            <button
              className="btn btn--lg btn--block"
              disabled={busy !== null}
              onClick={() => void restore('replace')}
            >
              Restore from backup (replace)
            </button>
            <button className="btn btn--lg btn--block btn--danger" onClick={() => void wipe()}>
              Erase all training data
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="row">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 550 }}>{label}</div>
          {hint && (
            <div className="tiny faint" style={{ marginTop: 2 }}>
              {hint}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="chips" style={{ flex: 'none' }}>
      {options.map(([key, label]) => (
        <button
          key={key}
          className={`chip chip--sm${value === key ? ' chip--on' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
