import { useState } from 'react'
import { Screen } from '../components/Screen'
import { EQUIPMENT, equipmentLabel } from '../core/format'
import {
  commitRoutine,
  resolveNames,
  type Decision,
  type NameResolution,
} from '../core/import/apply'
import { parseRoutineCsv } from '../core/import/parseRoutineCsv'
import { parseRoutineText } from '../core/import/parseRoutineText'
import type { ParsedRoutine } from '../core/import/types'
import { pickTextFile } from '../platform/share'
import { navigate } from '../router'

type Format = 'auto' | 'csv' | 'text'

const CSV_EXAMPLE = `routine,day,order,exercise,sets,note
GZCLP,Day A,1,Barbell Back Squat,5,5x3+ T1
GZCLP,Day A,2,Bench Press,3,3x10 T2
GZCLP,Day B,1,Deadlift,5,`

const TEXT_EXAMPLE = `# GZCLP

## Day A
- Barbell Back Squat 5x3+
- Bench Press 3x10
- Lat Pulldown 3x12

## Day B
- Deadlift 5x3`

function detectFormat(text: string, filename?: string): 'csv' | 'text' {
  if (filename) {
    if (/\.csv$/i.test(filename)) return 'csv'
    if (/\.(md|markdown|txt)$/i.test(filename)) return 'text'
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const first = lines[0] ?? ''
  if (/^\s*#/.test(first) || /^\s*[-*+•]\s/.test(first)) return 'text'
  // A header-ish first line plus more rows reads as a spreadsheet.
  if (/[,;\t]/.test(first) && lines.length > 1) return 'csv'
  return 'text'
}

export function ImportScreen() {
  const [raw, setRaw] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [format, setFormat] = useState<Format>('auto')
  const [parsed, setParsed] = useState<ParsedRoutine | null>(null)
  const [resolutions, setResolutions] = useState<NameResolution[]>([])
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadFile() {
    const file = await pickTextFile('.csv,.txt,.md,text/csv,text/plain,text/markdown')
    if (!file) return
    setFilename(file.name)
    setRaw(file.text)
    setError(null)
    await parse(file.text, file.name)
  }

  async function parse(text: string, sourceName?: string) {
    setError(null)
    const chosen = format === 'auto' ? detectFormat(text, sourceName) : format
    const fallback = sourceName?.replace(/\.[^.]+$/, '') || 'Imported routine'

    try {
      const result =
        chosen === 'csv' ? parseRoutineCsv(text, fallback) : parseRoutineText(text, fallback)
      setParsed(result)
      setName(result.name)
      setResolutions(await resolveNames(result))
      setDecisions(new Map())
    } catch (e) {
      setParsed(null)
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  async function commit() {
    if (!parsed) return
    setBusy(true)
    try {
      const { routineId } = await commitRoutine(
        { ...parsed, name: name.trim() || parsed.name },
        resolutions,
        decisions,
        raw,
      )
      navigate(`/routine/${routineId}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  function decide(exerciseName: string, decision: Decision) {
    setDecisions((prev) => new Map(prev).set(exerciseName, decision))
  }

  const unmatched = resolutions.filter((r) => !r.existing)
  const totalItems = parsed?.days.reduce((n, d) => n + d.items.length, 0) ?? 0

  if (parsed) {
    return (
      <Screen title="Review import" onBack={() => setParsed(null)}>
        <div className="stack-lg">
          <div>
            <div className="fieldlabel">Routine name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" />
          </div>

          {parsed.warnings.length > 0 && (
            <div className="card small" style={{ borderColor: 'var(--border-strong)' }}>
              {parsed.warnings.map((w) => (
                <div key={w} className="muted">
                  {w}
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="section-title">
              {parsed.days.length} day{parsed.days.length === 1 ? '' : 's'} · {totalItems} exercises
            </div>
            <div className="stack">
              {parsed.days.map((day, i) => (
                <div className="card" key={`${day.name}-${i}`}>
                  <div style={{ fontWeight: 620, marginBottom: 6 }}>{day.name}</div>
                  {day.items.map((item, j) => (
                    <div key={j} className="row small" style={{ gap: 8 }}>
                      <span className="faint num" style={{ width: 18 }}>
                        {j + 1}
                      </span>
                      <span style={{ flex: 1 }}>{item.exercise}</span>
                      <span className="faint num">{item.plannedSets}×</span>
                      {item.note && (
                        <span className="tiny faint" style={{ maxWidth: '38%', textAlign: 'right' }}>
                          {item.note}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {unmatched.length > 0 && (
            <div>
              <div className="section-title">
                {unmatched.length} new exercise{unmatched.length === 1 ? '' : 's'}
              </div>
              <div className="stack">
                {unmatched.map((r) => {
                  const decision = decisions.get(r.name)
                  const linked = decision?.action === 'link'
                  return (
                    <div className="card" key={r.name}>
                      <div className="row">
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 560 }}>{r.name}</div>
                          <div className="tiny faint">
                            used {r.uses} time{r.uses === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      {r.suggestion && (
                        <div className="row" style={{ marginTop: 8 }}>
                          <span className="small muted" style={{ flex: 1 }}>
                            Same as <strong>{r.suggestion.name}</strong>?
                          </span>
                          <button
                            className={`btn btn--sm${linked ? ' btn--primary' : ''}`}
                            onClick={() =>
                              linked
                                ? decide(r.name, { action: 'create', equipment: 'barbell' })
                                : decide(r.name, {
                                    action: 'link',
                                    exerciseId: r.suggestion!.id,
                                  })
                            }
                          >
                            {linked ? 'Linked' : 'Link'}
                          </button>
                        </div>
                      )}

                      {!linked && (
                        <>
                          <div className="fieldlabel" style={{ marginTop: 10 }}>
                            Equipment
                          </div>
                          <div className="chips">
                            {EQUIPMENT.map((eq) => {
                              const on =
                                decision?.action === 'create'
                                  ? decision.equipment === eq
                                  : eq === 'barbell'
                              return (
                                <button
                                  key={eq}
                                  className={`chip chip--sm${on ? ' chip--on' : ''}`}
                                  onClick={() => decide(r.name, { action: 'create', equipment: eq })}
                                >
                                  {equipmentLabel(eq)}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {resolutions.length > unmatched.length && (
            <p className="small faint">
              {resolutions.length - unmatched.length} exercise
              {resolutions.length - unmatched.length === 1 ? '' : 's'} already in your library will
              be reused.
            </p>
          )}

          {error && <div className="card small" style={{ color: 'var(--warn)' }}>{error}</div>}

          <button
            className="btn btn--primary btn--lg btn--block"
            disabled={busy}
            onClick={() => void commit()}
          >
            {busy ? 'Importing…' : 'Import routine'}
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title="Import routine" onBack>
      <div className="stack-lg">
        <div className="stack">
          <button className="btn btn--primary btn--lg btn--block" onClick={() => void loadFile()}>
            Choose a file
          </button>
          <p className="tiny faint">
            CSV from a spreadsheet, or Markdown/plain text. On iPhone this opens Files and iCloud
            Drive.
          </p>
        </div>

        <div>
          <div className="section-title">Or paste it</div>
          <textarea
            rows={9}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setFilename(undefined)
            }}
            placeholder={TEXT_EXAMPLE}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14 }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <div className="chips" style={{ flex: 1 }}>
              {(['auto', 'csv', 'text'] as Format[]).map((f) => (
                <button
                  key={f}
                  className={`chip chip--sm${format === f ? ' chip--on' : ''}`}
                  onClick={() => setFormat(f)}
                >
                  {f === 'auto' ? 'Auto' : f === 'csv' ? 'CSV' : 'Text'}
                </button>
              ))}
            </div>
            <button
              className="btn btn--sm btn--primary"
              disabled={!raw.trim()}
              onClick={() => void parse(raw, filename)}
            >
              Preview
            </button>
          </div>
        </div>

        {error && (
          <div className="card small" style={{ color: 'var(--warn)' }}>
            {error}
          </div>
        )}

        <div>
          <div className="section-title">Formats</div>
          <div className="stack">
            <div className="card">
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                Spreadsheet (CSV)
              </div>
              <pre className="tiny faint" style={{ overflowX: 'auto', whiteSpace: 'pre' }}>
                {CSV_EXAMPLE}
              </pre>
              <p className="tiny faint" style={{ marginTop: 8 }}>
                Only <code>exercise</code> is required. Semicolons and tabs are detected
                automatically, so a Norwegian Excel export works as-is.
              </p>
            </div>
            <div className="card">
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                Markdown / text
              </div>
              <pre className="tiny faint" style={{ overflowX: 'auto', whiteSpace: 'pre' }}>
                {TEXT_EXAMPLE}
              </pre>
              <p className="tiny faint" style={{ marginTop: 8 }}>
                A trailing <code>5x3</code> sets the number of sets; the rest becomes a note.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  )
}
