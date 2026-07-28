import { useEffect, useRef, useState } from 'react'

/**
 * A numeric text field that keeps its own draft string. A plain controlled
 * `value={n}` input would clobber half-typed values like "137." on every
 * keystroke, and Norwegian keyboards emit "," as the decimal separator.
 */
export function NumberField({
  value,
  onChange,
  placeholder,
  decimal = false,
  min,
  ariaLabel,
  className = 'numfield',
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  placeholder?: string
  decimal?: boolean
  min?: number
  ariaLabel?: string
  className?: string
}) {
  const [draft, setDraft] = useState(() => (value === undefined ? '' : String(value)))
  const focused = useRef(false)

  // Accept external updates only while the user is not mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(value === undefined ? '' : String(value))
  }, [value])

  function handle(raw: string) {
    const cleaned = raw.replace(',', '.')
    setDraft(cleaned)

    if (cleaned.trim() === '') {
      onChange(undefined)
      return
    }
    const n = Number(cleaned)
    // Commit on every valid keystroke so nothing is lost if the app is closed.
    if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n)
  }

  return (
    <input
      className={className}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      // 'decimal' shows a keypad with a separator key; 'numeric' digits only.
      pattern={decimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onFocus={(e) => {
        focused.current = true
        e.currentTarget.select()
      }}
      onBlur={() => {
        focused.current = false
        setDraft(value === undefined ? '' : String(value))
      }}
      onChange={(e) => handle(e.target.value)}
    />
  )
}
