import { Link } from '../router'
import {
  IconHistory,
  IconLibrary,
  IconProgress,
  IconSettings,
  IconToday,
} from './Icons'

const TABS = [
  { to: '/', label: 'Today', Icon: IconToday },
  { to: '/history', label: 'History', Icon: IconHistory },
  { to: '/progress', label: 'Progress', Icon: IconProgress },
  { to: '/library', label: 'Library', Icon: IconLibrary },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
]

export function Nav({ path }: { path: string }) {
  return (
    <nav className="nav">
      {TABS.map(({ to, label, Icon }) => {
        const active = to === '/' ? path === '/' : path.startsWith(to)
        return (
          <Link key={to} to={to} aria-current={active ? 'page' : undefined}>
            <Icon />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
