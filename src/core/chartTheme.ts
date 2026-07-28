/**
 * Chart colours, kept separate from the UI accent.
 *
 * Every chart here plots a single series, so the job is magnitude, not identity:
 * one hue, no categorical ramp, no legend. The two marks below were checked with
 * the palette validator against their own surface — the dark-mode step is
 * deliberately deeper than the interface accent (#ff7a3d), which sits above the
 * dark lightness band and would read as a button rather than data.
 */
export interface ChartTheme {
  mark: string
  grid: string
  axis: string
  surface: string
}

export const CHART_THEMES: Record<'dark' | 'light', ChartTheme> = {
  dark: { mark: '#e8621f', grid: '#262e39', axis: '#5c6675', surface: '#14181d' },
  light: { mark: '#e0561b', grid: '#dde2e9', axis: '#8d99a9', surface: '#ffffff' },
}
