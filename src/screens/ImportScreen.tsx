import { useState } from 'react'
import { Screen } from '../components/Screen'
import { EQUIPMENT, equipmentLabel } from '../core/format'
import {
  commitRoutine,
  resolveNames,
  type Decision,
  type NameResolution,
} from '../core/import/apply'
import { hashSource } from '../core/import/hash'
import { parseRoutineCsv } from '../core/import/parseRoutineCsv'
import { parseRoutineText } from '../core/import/parseRoutineText'
import type { ParsedRoutine } from '../core/import/types'
import { createRoutineSource } from '../db/queries'
import { fetchSource, normaliseSourceUrl, SourceError } from '../platform/fetchSource'
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
  /** Corrected names being typed for unreadable lines, keyed by the raw name. */
  const [nameDrafts, setNameDrafts] = useState<Map<string, string>>(new Map())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  /**
   * The link the previewed text came from, if any. Set only after a successful
   * fetch, so a subscription is never created for text that was pasted or
   * picked — the URL has to be the thing we can go back to.
   */
  const [linkedUrl, setLinkedUrl] = useState<string | undefined>()
  const [fetching, setFetching] = useState(false)

  async function loadLink() {
    setFetching(true)
    setError(null)
    try {
      const clean = normaliseSourceUrl(url)
      const fetched = await fetchSource(clean)
      setLinkedUrl(clean)
      setFilename(undefined)
      setRaw(fetched.text)
      setFormat(fetched.format)
      await parse(fetched.text, undefined, fetched.format)
    } catch (e) {
      setLinkedUrl(undefined)
      setError(e instanceof SourceError ? e.message : 'Could not read that link.')
    } finally {
      setFetching(false)
    }
  }

  async function loadFile() {
    const file = await pickTextFile('.csv,.txt,.md,text/csv,text/plain,text/markdown')
    if (!file) return
    setLinkedUrl(undefined)
    setFilename(file.name)
    setRaw(file.text)
    setError(null)
    await parse(file.text, file.name)
  }

  async function parse(text: string, sourceName?: string, override?: 'csv' | 'text') {
    setError(null)
    // The override matters for a fetched link: `format` was only just set from
    // the response, and this runs before React has applied it.
    const chosen = override ?? (format === 'auto' ? detectFormat(text, sourceName) : format)
    const fallback = sourceName?.replace(/\.[^.]+$/, '') || 'Imported routine'

    try {
      const result =
        chosen === 'csv' ? parseRoutineCsv(text, fallback) : parseRoutineText(text, fallback)
      const resolved = await resolveNames(result)
      setParsed(result)
      setName(result.name)
      setResolutions(resolved)

      // Lines the parser could not read start out skipped. Creating an exercise
      // from a guess is the failure this whole screen exists to prevent, so the
      // safe option has to be the one that happens if nothing is touched.
      const initial = new Map<string, Decision>()
      const drafts = new Map<string, string>()
      for (const r of resolved) {
        if (!r.unreadable) continue
        initial.set(r.name, { action: 'skip' })
        drafts.set(r.name, r.name)
      }
      setDecisions(initial)
      setNameDrafts(drafts)
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

      // Subscribing is a side effect of importing *from a link* — the routine
      // is now something we can go back and re-read, which pasted text is not.
      if (linkedUrl) {
        await createRoutineSource({
          url: linkedUrl,
          routineId,
          format: format === 'auto' ? 'csv' : format,
          lastHash: hashSource(raw),
        })
      }

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

  const unreadable = resolutions.filter((r) => r.unreadable)
  const unmatched = resolutions.filter((r) => !r.existing && !r.unreadable)
  const totalItems = parsed?.days.reduce((n, d) => n + d.items.length, 0) ?? 0

  // Anything much above 8 is far more likely to be a weight than a set count.
  const implausible = (parsed?.days ?? [])
    .flatMap((d) => d.items)
    .filter((i) => i.rawSets !== undefined && i.rawSets > 8)

  const skipCount = [...decisions.values()].filter((d) => d.action === 'skip').length

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

          {implausible.length > 0 && (
            <div className="card small callout callout--warn">
              {implausible.map((i, n) => (
                <div key={`${i.exercise}-${n}`} style={{ marginBottom: 4 }}>
                  <strong>
                    {i.exercise}: {i.rawSets} sets
                  </strong>{' '}
                  — did you mean {i.rawSets} kg? The first number is the set count. Importing this
                  lays out {i.plannedSets} rows.
                </div>
              ))}
            </div>
          )}

          {unreadable.length > 0 && (
            <div>
              <div className="section-title" style={{ color: 'var(--warn)' }}>
                Couldn’t read {unreadable.length} line{unreadable.length === 1 ? '' : 's'}
              </div>
              <p className="tiny faint" style={{ marginBottom: 8 }}>
                No set count was recognised and nothing in your library matches. These are
                <strong> skipped</strong> unless you correct them — the app won’t invent an
                exercise from a line it didn’t understand.
              </p>
              <div className="stack">
                {unreadable.map((r) => {
                  const decision = decisions.get(r.name)
                  const adding = decision?.action === 'rename'
                  const draft = nameDrafts.get(r.name) ?? r.name
                  return (
                    <div className="card" key={r.name}>
                      <code className="tiny" style={{ color: 'var(--warn)', wordBreak: 'break-all' }}>
                        {r.name}
                      </code>
                      <div className="tiny faint" style={{ margin: '2px 0 8px' }}>
                        used {r.uses} time{r.uses === 1 ? '' : 's'}
                      </div>

                      <input
                        value={draft}
                        placeholder="Correct name"
                        autoCapitalize="words"
                        autoCorrect="off"
                        onChange={(e) => {
                          const value = e.target.value
                          setNameDrafts((prev) => new Map(prev).set(r.name, value))
                          if (adding) {
                            decide(r.name, {
                              action: 'rename',
                              name: value,
                              equipment:
                                decision?.action === 'rename' ? decision.equipment : 'barbell',
                            })
                          }
                        }}
                      />

                      <div className="row" style={{ marginTop: 8, gap: 8 }}>
                        <button
                          className={`btn btn--sm${!adding ? ' btn--primary' : ''}`}
                          onClick={() => decide(r.name, { action: 'skip' })}
                        >
                          Skip
                        </button>
                        <button
                          className={`btn btn--sm${adding ? ' btn--primary' : ''}`}
                          onClick={() =>
                            decide(r.name, {
                              action: 'rename',
                              name: draft,
                              equipment: 'barbell',
                            })
                          }
                        >
                          Add as “{draft.trim() || '…'}”
                        </button>
                      </div>

                      {adding && (
                        <>
                          <div className="fieldlabel" style={{ marginTop: 10 }}>
                            Equipment
                          </div>
                          <div className="chips">
                            {EQUIPMENT.map((eq) => (
                              <button
                                key={eq}
                                className={`chip chip--sm${
                                  decision.equipment === eq ? ' chip--on' : ''
                                }`}
                                onClick={() =>
                                  decide(r.name, {
                                    action: 'rename',
                                    name: draft,
                                    equipment: eq,
                                  })
                                }
                              >
                                {equipmentLabel(eq)}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
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
                      <span
                        style={{
                          flex: 1,
                          color: decisions.get(item.exercise)?.action === 'skip'
                            ? 'var(--text-faint)'
                            : undefined,
                          textDecoration:
                            decisions.get(item.exercise)?.action === 'skip'
                              ? 'line-through'
                              : undefined,
                        }}
                      >
                        {item.exercise}
                      </span>
                      <span
                        className="num"
                        style={{
                          color:
                            item.rawSets !== undefined && item.rawSets > 8
                              ? 'var(--warn)'
                              : 'var(--text-faint)',
                          fontWeight: item.rawSets !== undefined && item.rawSets > 8 ? 700 : 400,
                        }}
                      >
                        {item.plannedSets}×
                      </span>
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

          {resolutions.some((r) => r.existing) && (
            <p className="small faint">
              {resolutions.filter((r) => r.existing).length} exercise
              {resolutions.filter((r) => r.existing).length === 1 ? '' : 's'} already in your
              library will be reused.
            </p>
          )}

          {error && <div className="card small" style={{ color: 'var(--warn)' }}>{error}</div>}

          <button
            className="btn btn--primary btn--lg btn--block"
            disabled={busy}
            onClick={() => void commit()}
          >
            {busy
              ? 'Importing…'
              : skipCount > 0
                ? `Import routine, skipping ${skipCount}`
                : 'Import routine'}
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title="Import routine" onBack>
      <div className="stack-lg">
        <div>
          <div className="section-title">From a link</div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/…/pub?output=csv"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            className="btn btn--primary btn--lg btn--block"
            style={{ marginTop: 10 }}
            disabled={!url.trim() || fetching}
            onClick={() => void loadLink()}
          >
            {fetching ? 'Fetching…' : 'Fetch and preview'}
          </button>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            A routine imported from a link keeps checking it. When your coach edits the sheet, the
            change arrives the next time you open the app — as long as every exercise is one you
            already have. Anything new waits for you to approve it.
          </p>
          <p className="tiny faint">
            In Google Sheets: <strong>File → Share → Publish to web</strong>, then choose
            <strong> Comma-separated values (.csv)</strong>. The editing link will not work.
          </p>
        </div>

        <div className="stack">
          <button className="btn btn--lg btn--block" onClick={() => void loadFile()}>
            Choose a file
          </button>
          <p className="tiny faint">
            A one-off import. CSV from a spreadsheet, or Markdown/plain text — on iPhone this opens
            Files and iCloud Drive.
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
              // Edited text is no longer what the link served, so it cannot be
              // kept in step with one.
              setLinkedUrl(undefined)
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
                The <strong>first</strong> number is the set count — <code>5x3</code> means five
                sets, not 5&nbsp;kg. Everything after it is kept as a note and shown while you
                lift, but never enforced.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  )
}
