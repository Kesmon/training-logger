import type { ReactNode } from 'react'
import { back } from '../router'
import { IconBack } from './Icons'

export function Screen({
  title,
  onBack,
  actions,
  hideNav,
  children,
}: {
  title: ReactNode
  /** Shows a back chevron. Pass `true` for history.back(). */
  onBack?: boolean | (() => void)
  actions?: ReactNode
  hideNav?: boolean
  children: ReactNode
}) {
  return (
    <>
      <header className="header">
        {onBack && (
          <button
            className="btn btn--icon btn--ghost"
            style={{ border: 'none', marginLeft: -10 }}
            onClick={typeof onBack === 'function' ? onBack : back}
            aria-label="Back"
          >
            <IconBack />
          </button>
        )}
        <h1>{title}</h1>
        {actions}
      </header>
      <main className={hideNav ? 'main main--nonav' : 'main'}>{children}</main>
    </>
  )
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
