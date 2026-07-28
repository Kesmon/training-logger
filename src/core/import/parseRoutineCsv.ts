import {
  cleanExerciseName,
  clampSets,
  extractSets,
  type ParsedDay,
  type ParsedRoutine,
} from './types'

/**
 * Real spreadsheet exports are not clean, so this parser is deliberately
 * forgiving: it sniffs the delimiter, tolerates a BOM, accepts several header
 * spellings in English and Norwegian, and only truly requires an exercise name.
 */

const DELIMITERS = [',', ';', '\t', '|'] as const

/**
 * Excel writes ';' in any locale that uses ',' as the decimal separator —
 * Norwegian, German, French. Guessing ',' there yields one giant column and
 * looks like the file is broken, so the delimiter is counted rather than assumed.
 */
export function detectDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5)
  let best = ','
  let bestScore = -1

  for (const d of DELIMITERS) {
    // Count only outside quotes, so a quoted "Squat, paused" does not inflate ','.
    const counts = firstLines.map((line) => {
      let n = 0
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"') inQuotes = !inQuotes
        else if (c === d && !inQuotes) n++
      }
      return n
    })
    if (counts.length === 0 || counts[0] === 0) continue

    // Prefer the delimiter that appears consistently on every line.
    const first = counts[0]!
    const consistent = counts.every((c) => c === first)
    const score = first * (consistent ? 10 : 1)
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** RFC 4180 row splitter: handles quoted fields, escaped quotes and CRLF. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  row.push(field)
  rows.push(row)

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

type Column = 'routine' | 'day' | 'order' | 'exercise' | 'sets' | 'note'

// Norwegian spellings are included because that is what this user's Excel writes.
const HEADERS: Record<Column, string[]> = {
  routine: ['routine', 'program', 'programme', 'plan', 'rutine', 'økt'],
  day: ['day', 'workout', 'session', 'dag', 'treningsdag'],
  order: ['order', 'no', 'num', 'nr', '#', 'index', 'rekkefølge'],
  exercise: ['exercise', 'movement', 'lift', 'øvelse', 'ovelse'],
  sets: ['sets', 'set', 'sett', 'antallsett'],
  note: ['note', 'notes', 'reps', 'prescription', 'target', 'scheme', 'kommentar', 'merknad'],
}

function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]/g, '')
}

function mapColumns(header: string[]): Partial<Record<Column, number>> {
  const norm = header.map(normaliseHeader)
  const map: Partial<Record<Column, number>> = {}

  for (const [col, names] of Object.entries(HEADERS) as [Column, string[]][]) {
    const idx = norm.findIndex((h) => names.includes(h))
    if (idx >= 0) map[col] = idx
  }

  // 'name' is ambiguous: treat it as the exercise only when no better column
  // exists, since a sheet with both would use 'name' for the routine.
  if (map.exercise === undefined) {
    const idx = norm.findIndex((h) => h === 'name' || h === 'navn')
    if (idx >= 0) map.exercise = idx
  }
  return map
}

export function parseRoutineCsv(text: string, fallbackName = 'Imported routine'): ParsedRoutine {
  const warnings: string[] = []
  // Excel prepends a UTF-8 BOM; left in place it corrupts the first header.
  const clean = text.replace(/^﻿/, '')

  const delimiter = detectDelimiter(clean)
  if (delimiter !== ',') {
    warnings.push(`Detected "${delimiter === '\t' ? 'tab' : delimiter}" as the column separator.`)
  }

  const rows = splitCsv(clean, delimiter)
  if (rows.length === 0) throw new Error('That file appears to be empty.')

  const header = rows[0]!
  const cols = mapColumns(header)
  let body = rows.slice(1)

  if (cols.exercise === undefined) {
    if (Object.keys(cols).length > 0) {
      // A header was recognised but names no exercise column. Fall back to the
      // first column nothing else claimed rather than discarding the header.
      const used = new Set(Object.values(cols))
      const idx = header.findIndex((_, i) => !used.has(i))
      cols.exercise = idx >= 0 ? idx : 0
      warnings.push(`No "exercise" column — using "${(header[cols.exercise] ?? '').trim()}".`)
    } else {
      // Nothing matched at all, so there is no header: row 0 is already data.
      cols.exercise = 0
      body = rows
      if (header.length > 1 && /^\d+$/.test((header[1] ?? '').trim())) cols.sets = 1
      warnings.push('No header row found — reading the first column as the exercise name.')
    }
  }

  const cell = (row: string[], col: number | undefined): string =>
    col === undefined ? '' : (row[col] ?? '').trim()

  const dayOrder: string[] = []
  const days = new Map<string, { day: ParsedDay; orders: number[] }>()
  let routineName = ''
  let skipped = 0

  for (const row of body) {
    const exerciseCell = cell(row, cols.exercise)
    if (!exerciseCell) {
      skipped++
      continue
    }

    if (!routineName) routineName = cell(row, cols.routine)

    const dayName = cell(row, cols.day) || 'Day 1'
    if (!days.has(dayName)) {
      days.set(dayName, { day: { name: dayName, items: [] }, orders: [] })
      dayOrder.push(dayName)
    }

    const noteCell = cell(row, cols.note)
    // The exercise cell may itself carry the scheme, as in "Squat 5x5".
    const inline = extractSets(exerciseCell)

    const setsCell = cell(row, cols.sets)
    const fromColumn = setsCell ? Number(setsCell.replace(',', '.')) : NaN
    const fromNote = noteCell ? extractSets(noteCell).sets : undefined

    const explicit = Number.isFinite(fromColumn)
    const resolved = explicit ? fromColumn : (inline.sets ?? fromNote)

    const entry = days.get(dayName)!
    entry.day.items.push({
      exercise: inline.name || cleanExerciseName(exerciseCell),
      plannedSets: clampSets(resolved),
      note: noteCell || inline.note || undefined,
      // A dedicated sets column counts as recognised even with no inline scheme.
      recognised: resolved !== undefined && Number.isFinite(resolved),
      rawSets: Number.isFinite(resolved) ? resolved : undefined,
    })

    // Recorded positionally, so sorting cannot be thrown off by a name the
    // parser rewrote when stripping an inline scheme.
    const orderValue = Number(cell(row, cols.order))
    entry.orders.push(Number.isFinite(orderValue) ? orderValue : entry.orders.length)
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with no exercise.`)
  }

  const ordered = dayOrder.map((name) => {
    const { day, orders } = days.get(name)!
    if (cols.order !== undefined) {
      day.items = day.items
        .map((item, i) => ({ item, sort: orders[i] ?? i }))
        .sort((a, b) => a.sort - b.sort)
        .map((x) => x.item)
    }
    return day
  })

  if (ordered.length === 0) throw new Error('No exercises found in that file.')

  return { name: routineName || fallbackName, days: ordered, source: 'csv', warnings }
}
