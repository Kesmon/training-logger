type P = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const IconToday = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9v6M20 9v6M7.5 6.5v11M16.5 6.5v11M7.5 12h9" />
  </svg>
)

export const IconHistory = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
)

export const IconProgress = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="M7.5 15.5l3.5-4 3 2.5 4.5-6" />
  </svg>
)

export const IconLibrary = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 14a2 2 0 0 1-2-2 2 2 0 0 1 2-2 1.6 1.6 0 0 0 1.5-2.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 3.9V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3 1.2z" />
  </svg>
)

export const IconChevron = (p: P) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

export const IconBack = (p: P) => (
  <svg {...base} width="22" height="22" {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export const IconPlus = (p: P) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base} width="19" height="19" {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 12h10l1-12" />
  </svg>
)

export const IconTrophy = (p: P) => (
  <svg {...base} width="14" height="14" strokeWidth={2.1} {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 5.5H4.5V7a3 3 0 0 0 3 3M17 5.5h2.5V7a3 3 0 0 1-3 3" />
    <path d="M12 14v3M9 20h6" />
  </svg>
)

export const IconDots = (p: P) => (
  <svg {...base} width="20" height="20" {...p}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </svg>
)
