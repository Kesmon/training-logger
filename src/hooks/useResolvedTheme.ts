import { useEffect, useState } from 'react'
import { CHART_THEMES, type ChartTheme } from '../core/chartTheme'
import { useSettings } from './useSettings'

/** The theme actually in effect, resolving 'system' against the OS setting. */
export function useResolvedTheme(): 'dark' | 'light' {
  const settings = useSettings()
  const [system, setSystem] = useState<'dark' | 'light'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return settings.theme === 'system' ? system : settings.theme
}

export function useChartTheme(): ChartTheme {
  return CHART_THEMES[useResolvedTheme()]
}
