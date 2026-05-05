import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { borderRadius, colors } from '../design/tokens'

export interface ContextMenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
}

export interface ContextMenuPosition {
  readonly x: number
  readonly y: number
}

export interface ContextMenuProps {
  readonly position: ContextMenuPosition
  readonly items: readonly ContextMenuItem[]
  readonly onClose: () => void
}

const MENU_MIN_WIDTH = 160
const MENU_PADDING = 4
const ITEM_HEIGHT = 28
const VIEWPORT_MARGIN = 8

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number>(() => firstEnabled(items))

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
        const item = items[active]
        if (item && !item.disabled) {
          item.onSelect()
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

  const clamped = clampPosition(position, items.length)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        top: clamped.y,
        left: clamped.x,
        minWidth: MENU_MIN_WIDTH,
        padding: MENU_PADDING,
        background: colors.bg.elevated,
        border: `0.5px solid ${colors.border.default}`,
        borderRadius: borderRadius.container,
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
        zIndex: 1000,
        fontSize: 12
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onMouseEnter={() => !item.disabled && setActive(i)}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            border: 'none',
            background: active === i && !item.disabled ? colors.bg.base : 'transparent',
            color: item.disabled
              ? colors.text.muted
              : item.destructive
                ? colors.claude.error
                : colors.text.primary,
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            borderRadius: borderRadius.inline,
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

function firstEnabled(items: readonly ContextMenuItem[]): number {
  const idx = items.findIndex((i) => !i.disabled)
  return idx === -1 ? 0 : idx
}

function nextEnabled(items: readonly ContextMenuItem[], from: number, dir: 1 | -1): number {
  if (items.length === 0) return 0
  let i = from
  for (let step = 0; step < items.length; step += 1) {
    i = (i + dir + items.length) % items.length
    if (!items[i].disabled) return i
  }
  return from
}

function clampPosition(pos: ContextMenuPosition, itemCount: number): ContextMenuPosition {
  const height = itemCount * ITEM_HEIGHT + MENU_PADDING * 2
  const width = MENU_MIN_WIDTH
  const maxX = window.innerWidth - width - VIEWPORT_MARGIN
  const maxY = window.innerHeight - height - VIEWPORT_MARGIN
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(pos.x, maxX)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(pos.y, maxY))
  }
}
