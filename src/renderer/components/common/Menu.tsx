import { useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  readonly label: string
  readonly icon?: IconName
  readonly tone?: 'danger'
  readonly onSelect: () => void
}

/**
 * A small action menu on the platform's popover: light dismiss (outside click), Escape, and the
 * top layer come from the browser, so there is no positioning or outside-click code here.
 * Keyboard: opens focused on its first item, arrows move, Escape closes and returns focus to the button.
 */
export function Menu({ label, items, trigger }: { label: string; items: readonly MenuItem[]; trigger?: ReactNode }) {
  const id = useId()
  // Each menu names its anchor, so the popover can sit under its own button (CSS anchor positioning).
  const anchor = { '--anchor': `--menu-${id.replace(/[^a-zA-Z0-9]/g, '')}` } as CSSProperties
  const menu = useRef<HTMLDivElement>(null)

  const focusItem = (delta: 1 | -1 | 0): void => {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = delta === 0 ? 0 : (index + delta + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        popoverTarget={id}
        style={anchor}
      >
        {trigger ?? <Icon name="more" size={20} />}
      </button>
      <div
        ref={menu}
        id={id}
        className="menu"
        role="menu"
        aria-label={label}
        popover="auto"
        style={anchor}
        onToggle={(event) => {
          if ((event.nativeEvent as ToggleEvent).newState === 'open') focusItem(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusItem(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusItem(-1)
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="menu-item"
            data-tone={item.tone}
            onClick={() => {
              menu.current?.hidePopover()
              item.onSelect()
            }}
          >
            {item.icon === undefined ? null : <Icon name={item.icon} size={16} />}
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
