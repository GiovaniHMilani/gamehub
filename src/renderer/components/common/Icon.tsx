import type { SVGProps } from 'react'

/** The few glyphs the shell needs, drawn on a 20-unit grid. Decorative: the control that holds one is always labelled. */
const PATHS = {
  play: 'M6.5 4.2v11.6a.7.7 0 0 0 1.07.6l9-5.8a.7.7 0 0 0 0-1.2l-9-5.8a.7.7 0 0 0-1.07.6Z',
  stop: 'M5.5 5.5h9v9h-9z',
  restart: 'M15.5 10a5.5 5.5 0 1 1-1.8-4.07M15.8 3.6v3.4h-3.4',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  plus: 'M10 4.5v11M4.5 10h11',
  library: 'M3.500 7.500A1.500 1.500 0 0 1 5 6h5.500A1.500 1.500 0 0 1 12 7.500V15a1.500 1.500 0 0 1-1.500 1.500H5A1.500 1.500 0 0 1 3.500 15ZM7.500 4.200A1.500 1.500 0 0 1 9 3h6a1.500 1.500 0 0 1 1.500 1.500V12M6.500 12.500h3',
  controller: 'M6.5 6h7a4 4 0 0 1 3.9 3.1l.7 3.6a2.2 2.2 0 0 1-3.9 1.7L12.8 12H7.2l-1.4 2.4a2.2 2.2 0 0 1-3.9-1.7l.7-3.6A4 4 0 0 1 6.5 6ZM6.6 8.2v2.4M5.4 9.4h2.4M13 9h.01M14.6 10.2h.01',
  settings: 'M4 6.5h6M14.5 6.5H16M4 13.5h1.5M9.5 13.5H16M12.500 4.500a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM7.500 11.500a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  expand: 'M12 4h4v4M8 16H4v-4M16 4l-4.5 4.5M4 16l4.5-4.5',
  one: 'M4.5 5.5h11v9h-11z',
  grid: 'M4.5 4.5h4.2v4.2H4.500zM11.300 4.500h4.200v4.200h-4.200zM4.500 11.300h4.200v4.200H4.500zM11.300 11.300h4.200v4.200h-4.200z',
  edit: 'M4 16h3l8.200-8.200a1.400 1.400 0 0 0 0-2L14.200 4.800a1.400 1.400 0 0 0-2 0L4 13Zm7.200-9.800 2.600 2.600',
  globe: 'M10 16.500a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13ZM3.500 10h13M10 3.500c1.800 1.800 2.700 4 2.700 6.500s-.9 4.700-2.700 6.500c-1.800-1.800-2.700-4-2.700-6.500S8.200 5.300 10 3.500Z',
  trash: 'M4.500 6h11M8 6V4.500h4V6M6 6l.6 9.500h6.800L14 6M8.500 8.500v4.500M11.500 8.500v4.500',
  close: 'M5 5l10 10M15 5 5 15',
} as const

export type IconName = keyof typeof PATHS

const FILLED: ReadonlySet<IconName> = new Set(['play', 'stop'])

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const filled = FILLED.has(name)
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
