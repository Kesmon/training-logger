import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../db/queries'
import { DEFAULT_SETTINGS, type Settings } from '../db/schema'

/** Live settings, falling back to defaults before the first read resolves. */
export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
}
