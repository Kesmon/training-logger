import { useEffect, type ReactNode } from 'react'

/** Bottom sheet. Used for the exercise picker and any confirm-style flow. */
export function Sheet({
  title,
  onClose,
  actions,
  children,
}: {
  title: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  // The page behind must not scroll while a sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet__grip" />
        <div className="sheet__head">
          <h2>{title}</h2>
          {actions}
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
