import type { Equipment, EffortType, SetType, Unit } from '../db/schema'

/** Weight is always stored in kg; the unit setting is a display concern only. */
export const LB_PER_KG = 2.20462262185

export function kgToDisplay(kg: number, unit: Unit): number {
  return unit === 'lb' ? kg * LB_PER_KG : kg
}

export function displayToKg(value: number, unit: Unit): number {
  return unit === 'lb' ? value / LB_PER_KG : value
}

/** Trims trailing zeros: 137.5 -> "137.5", 140.0 -> "140". */
export function trimNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(decimals)))
}

export function fmtWeight(kg: number | undefined, unit: Unit, withUnit = false): string {
  if (kg === undefined || kg === null) return ''
  const v = trimNum(kgToDisplay(kg, unit), unit === 'lb' ? 1 : 2)
  return withUnit ? `${v} ${unit}` : v
}

export function fmtEffort(type: EffortType | undefined, value: number | undefined): string {
  if (!type || value === undefined) return ''
  return type === 'rpe' ? `@${trimNum(value, 1)}` : `${trimNum(value, 0)} RIR`
}

/** "2026-07-12" -> "12 Jul". Includes the year when it is not the current one. */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(y, m - 1, d)
  const month = dt.toLocaleDateString(undefined, { month: 'short' })
  const thisYear = new Date().getFullYear()
  return y === thisYear ? `${d} ${month}` : `${d} ${month} ${y}`
}

export function fmtDayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' })
}

/** Monday of the week containing `date`, as YYYY-MM-DD. Buckets weekly charts. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)) // getDay(): Sunday is 0
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function sessionDuration(startedAt: string, endedAt?: string): number | undefined {
  if (!endedAt) return undefined
  return (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
}

// ---------------------------------------------------------------- vocabulary

export const SET_TYPES: SetType[] = [
  'working',
  'warmup',
  'top',
  'backoff',
  'drop',
  'amrap',
  'failure',
  'myorep',
  'restpause',
]

const SET_TYPE_LABELS: Record<SetType, string> = {
  working: 'Working',
  warmup: 'Warm-up',
  top: 'Top set',
  backoff: 'Back-off',
  drop: 'Drop set',
  amrap: 'AMRAP',
  failure: 'To failure',
  myorep: 'Myo-reps',
  restpause: 'Rest-pause',
}

/** Short marker shown on the set row; working sets get none. */
const SET_TYPE_SHORT: Record<SetType, string> = {
  working: '',
  warmup: 'W',
  top: 'TOP',
  backoff: 'BO',
  drop: 'DROP',
  amrap: 'AMRAP',
  failure: 'F',
  myorep: 'MYO',
  restpause: 'RP',
}

export const setTypeLabel = (t: SetType): string => SET_TYPE_LABELS[t]
export const setTypeShort = (t: SetType): string => SET_TYPE_SHORT[t]

/**
 * Sets fall into three kinds, not two.
 *
 * A drop set, myo-rep or rest-pause is a *continuation* of the set it extends —
 * it shares that set's rest period, which is what makes it an intensity
 * technique rather than extra volume. Counting it as another set inflates every
 * weekly set total: two rowing sets with a drop on the second would read as
 * three, and a hard cap of two would be exceeded without anyone seeing it.
 *
 * The load still moved, though, so continuations do count toward tonnage.
 */
export type SetCategory = 'preparatory' | 'working' | 'continuation'

const SET_CATEGORIES: Record<SetType, SetCategory> = {
  warmup: 'preparatory',
  working: 'working',
  top: 'working',
  backoff: 'working',
  amrap: 'working',
  // A set genuinely taken to failure is a set, not an extension of one.
  failure: 'working',
  drop: 'continuation',
  myorep: 'continuation',
  restpause: 'continuation',
}

export const setCategory = (t: SetType): SetCategory => SET_CATEGORIES[t]

/**
 * Whether this is a discrete hard set — the unit weekly volume caps, set
 * positions and personal records are counted in.
 */
export const countsAsWorkingSet = (t: SetType): boolean => setCategory(t) === 'working'

/** Whether real external load was moved. True for continuations, not warm-ups. */
export const movedLoad = (t: SetType): boolean => setCategory(t) !== 'preparatory'

export const EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'bodyweight_loaded',
  'assisted',
  'band',
  'other',
]

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  bodyweight_loaded: 'Bodyweight + load',
  assisted: 'Assisted',
  band: 'Band',
  other: 'Other',
}

export const equipmentLabel = (e: Equipment): string => EQUIPMENT_LABELS[e]

/** What the weight field means for this equipment — shown as the field label. */
export function weightLabel(equipment: Equipment, unit: Unit): string {
  switch (equipment) {
    case 'bodyweight_loaded':
      return `Added ${unit}`
    case 'assisted':
      return `Assist ${unit}`
    default:
      return unit
  }
}

export const MUSCLES = [
  'Chest',
  'Front delts',
  'Side delts',
  'Rear delts',
  'Lats',
  'Upper back',
  'Traps',
  'Biceps',
  'Triceps',
  'Forearms',
  'Abs',
  'Obliques',
  'Lower back',
  'Glutes',
  'Quads',
  'Hamstrings',
  'Adductors',
  'Calves',
]
