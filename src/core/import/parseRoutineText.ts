import { clampSets, extractSets, type ParsedDay, type ParsedRoutine } from './types'

/**
 * Markdown / plain text routines:
 *
 *   # GZCLP
 *   ## Day A
 *   - Barbell Back Squat 5x3+
 *   - Bench Press 3x10
 *
 * Degrades gracefully — a bare list with no headings becomes a one-day routine.
 */

const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/
const HEADING = /^\s*(#{1,6})\s*(.+?)\s*#*\s*$/
/** "Day A:" — a common way to write a day without Markdown. */
const COLON_HEADING = /^\s*(.{1,40}?):\s*$/

export function parseRoutineText(text: string, fallbackName = 'Imported routine'): ParsedRoutine {
  const warnings: string[] = []
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)

  let routineName = ''
  const days: ParsedDay[] = []
  let current: ParsedDay | undefined

  /** Heading depth that means "day". Set by the first heading level seen
   *  below the routine title, so ## and ### both work. */
  let dayLevel = 0

  const startDay = (name: string) => {
    current = { name, items: [] }
    days.push(current)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const heading = line.match(HEADING)
    if (heading) {
      const level = heading[1]!.length
      const title = heading[2]!.trim()
      if (!title) continue

      // The first level-1 heading titles the routine; deeper ones are days.
      if (!routineName && level === 1) {
        routineName = title
        continue
      }
      if (dayLevel === 0) dayLevel = level
      if (level <= dayLevel) startDay(title)
      else if (current) current.name = `${current.name} · ${title}`
      else startDay(title)
      continue
    }

    const colon = line.match(COLON_HEADING)
    if (colon && !BULLET.test(line)) {
      startDay(colon[1]!.trim())
      continue
    }

    const content = line.replace(BULLET, '').trim()
    if (!content) continue

    if (!current) startDay('Day 1')

    const { name, sets, note } = extractSets(content)
    if (!name) continue
    current!.items.push({ exercise: name, plannedSets: clampSets(sets), note })
  }

  const withItems = days.filter((d) => d.items.length > 0)
  if (withItems.length === 0) {
    throw new Error('No exercises found — expected one exercise per line.')
  }
  if (withItems.length < days.length) {
    warnings.push(`Ignored ${days.length - withItems.length} heading(s) with no exercises under them.`)
  }
  if (!routineName) {
    warnings.push('No "# Routine name" heading found.')
  }

  return {
    name: routineName || fallbackName,
    days: withItems,
    source: 'text',
    warnings,
  }
}
