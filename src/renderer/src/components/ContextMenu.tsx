import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { iconSize, iconStroke } from '../design/tokens'

export interface ContextMenuItem {
  /** Omitted kind means 'item' — keeps plain action arrays terse. */
  readonly kind?: 'item'
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
  readonly shortcut?: string
  readonly icon?: LucideIcon
}

export interface ContextMenuSeparator {
  readonly kind: 'separator'
  readonly id: string
}

export interface ContextMenuHeader {
  readonly kind: 'header'
  readonly id: string
  readonly label: string
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuHeader

export interface ContextMenuPosition {
  readonly x: number
  readonly y: number
}

interface ContextMenuProps {
  readonly position: ContextMenuPosition
  readonly items: readonly ContextMenuEntry[]
  readonly onClose: () => void
  /** Anchor the menu's bottom edge at the cursor so it grows upward. */
  readonly openUpward?: boolean
  /** Treat position.x as the menu's right edge (for button-anchored menus). */
  readonly alignRight?: boolean
  readonly minWidth?: number
  readonly testId?: string
}

const VIEWPORT_MARGIN = 8

function isItem(entry: ContextMenuEntry): entry is ContextMenuItem {
  return entry.kind === undefined || entry.kind === 'item'
}

function isSelectable(entry: ContextMenuEntry): boolean {
  return isItem(entry) && !entry.disabled
}

export function ContextMenu({
  position,
  items,
  onClose,
  openUpward = false,
  alignRight = false,
  minWidth = 160,
  testId
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number>(() => firstEnabled(items))
  // Render offscreen first, then measure and clamp — header/separator rows make
  // height estimates unreliable, so real geometry is the only honest clamp.
  const [coords, setCoords] = useState<ContextMenuPosition>({ x: position.x, y: -9999 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rawX = alignRight ? position.x - rect.width : position.x
    const rawY = openUpward ? position.y - rect.height : position.y
    const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN
    const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN
    setCoords({
      x: Math.max(VIEWPORT_MARGIN, Math.min(rawX, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(rawY, maxY))
    })
  }, [position.x, position.y, openUpward, alignRight, items.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => nextEnabled(items, i, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => nextEnabled(items, i, -1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const entry = items[active]
        if (entry && isItem(entry) && !entry.disabled) {
          entry.onSelect()
          onClose()
        }
      }
    }
    function onPointer(e: PointerEvent) {
      if (!ref.current) return
      if (e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [items, active, onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="te-ctx-menu"
      data-testid={testId}
      // Portaled menus still bubble React events to the tree that rendered
      // them (e.g. canvas cards) — keep menu interaction out of that tree.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{ position: 'fixed', top: coords.y, left: coords.x, minWidth }}
    >
      {items.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={entry.id} role="separator" className="te-ctx-menu__sep" />
        }
        if (entry.kind === 'header') {
          return (
            <div key={entry.id} className="te-ctx-menu__header">
              {entry.label}
            </div>
          )
        }
        const Icon = entry.icon
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="te-ctx-menu__item"
            data-active={(active === i && !entry.disabled) || undefined}
            data-destructive={entry.destructive || undefined}
            disabled={entry.disabled}
            onMouseEnter={() => !entry.disabled && setActive(i)}
            onClick={() => {
              if (entry.disabled) return
              entry.onSelect()
              onClose()
            }}
          >
            {Icon && (
              <Icon
                size={iconSize.sm}
                strokeWidth={iconStroke}
                className="te-ctx-menu__item-icon"
              />
            )}
            <span className="te-ctx-menu__item-label">{entry.label}</span>
            {entry.shortcut && <span className="te-ctx-menu__item-shortcut">{entry.shortcut}</span>}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

function firstEnabled(items: readonly ContextMenuEntry[]): number {
  const idx = items.findIndex(isSelectable)
  return idx === -1 ? 0 : idx
}

function nextEnabled(items: readonly ContextMenuEntry[], from: number, dir: 1 | -1): number {
  if (items.length === 0) return 0
  let i = from
  for (let step = 0; step < items.length; step += 1) {
    i = (i + dir + items.length) % items.length
    if (isSelectable(items[i])) return i
  }
  return from
}
