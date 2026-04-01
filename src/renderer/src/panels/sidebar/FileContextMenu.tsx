import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { colors, transitions, floatingPanel } from '../../design/tokens'

interface ContextMenuAction {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  /** Visual separator after this item */
  readonly separator?: boolean
  readonly danger?: boolean
}

const FILE_ACTIONS: readonly ContextMenuAction[] = [
  { id: 'open-split', label: 'Open in Split', shortcut: '⌘\\', separator: true },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'copy-path', label: 'Copy path', separator: true },
  { id: 'open-default', label: 'Open in default app' },
  { id: 'reveal-finder', label: 'Reveal in Finder', separator: true },
  { id: 'rename', label: 'Rename...' },
  { id: 'delete', label: 'Delete', danger: true }
]

const FOLDER_ACTIONS: readonly ContextMenuAction[] = [
  { id: 'new-file', label: 'New note in folder' },
  { id: 'map-to-canvas', label: 'Map to Canvas', separator: true },
  { id: 'copy-path', label: 'Copy path', separator: true },
  { id: 'reveal-finder', label: 'Reveal in Finder', separator: true },
  { id: 'rename', label: 'Rename...' },
  { id: 'delete', label: 'Delete', danger: true }
]

export interface FileContextMenuState {
  readonly x: number
  readonly y: number
  readonly path: string
  readonly isDirectory: boolean
}

interface FileContextMenuProps {
  state: FileContextMenuState | null
  onClose: () => void
  onAction: (actionId: string, path: string) => void
}

export function FileContextMenu({ state, onClose, onAction }: FileContextMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const menuRef = useRef<HTMLDivElement>(null)

  const actions = state?.isDirectory ? FOLDER_ACTIONS : FILE_ACTIONS

  // Close on click outside or Escape
  useEffect(() => {
    if (!state) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev + 1) % actions.length)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev - 1 + actions.length) % actions.length)
      }
      if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault()
        onAction(actions[focusedIndex].id, state.path)
        onClose()
      }
    }

    // Small delay to avoid the opening right-click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    document.addEventListener('keydown', handleKey)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [state, onClose, onAction, actions, focusedIndex])

  // Reset focus when menu opens
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on open
    setFocusedIndex(-1)
  }, [state])

  // Adjust position to stay within viewport
  const adjustedPosition = useAdjustedPosition(state, menuRef)

  if (!state) return null

  // Portal to document.body so the menu escapes the sidebar's stacking context.
  // The sidebar uses backdropFilter + overflow-hidden, which traps fixed-positioned
  // children inside its own stacking context and clips them.
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] py-1 rounded-md shadow-xl"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        backgroundColor: floatingPanel.glass.popoverBg,
        backdropFilter: floatingPanel.glass.popoverBlur,
        WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
        border: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        transition: `opacity ${transitions.tooltip}`,
        fontSize: '13px'
      }}
    >
      {actions.map((action, idx) => (
        <div key={action.id}>
          <button
            className="w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-default"
            style={{
              color: action.danger ? '#EF4444' : colors.text.primary,
              backgroundColor: focusedIndex === idx ? colors.bg.surface : undefined
            }}
            onMouseEnter={() => setFocusedIndex(idx)}
            onMouseLeave={() => setFocusedIndex(-1)}
            onClick={() => {
              onAction(action.id, state.path)
              onClose()
            }}
          >
            <span>{action.label}</span>
            {action.shortcut && (
              <span style={{ color: colors.text.muted, fontSize: '11px' }}>{action.shortcut}</span>
            )}
          </button>
          {action.separator && (
            <div className="my-1" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }} />
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}

/** Keep the menu within the visible viewport */
function useAdjustedPosition(
  state: FileContextMenuState | null,
  menuRef: React.RefObject<HTMLDivElement | null>
) {
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!state) return
    // Start at the click position
    let { x, y } = state

    // After the menu renders, adjust if it overflows
    requestAnimationFrame(() => {
      const el = menuRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8
      setPos({ x: Math.max(0, x), y: Math.max(0, y) })
    })

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial position before rAF adjusts
    setPos({ x, y })
  }, [state, menuRef])

  return pos
}

interface RenameInputProps {
  initialValue: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameInput({ initialValue, onConfirm, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Select the name without extension
    const dotIdx = initialValue.lastIndexOf('.')
    el.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length)
  }, [initialValue])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const trimmed = value.trim()
        if (trimmed && trimmed !== initialValue) {
          onConfirm(trimmed)
        } else {
          onCancel()
        }
      }
      if (e.key === 'Escape') {
        onCancel()
      }
    },
    [value, initialValue, onConfirm, onCancel]
  )

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      className="w-full bg-transparent outline-none text-sm px-1 py-0.5 rounded"
      style={{
        color: colors.text.primary,
        border: `1px solid ${colors.accent.default}`,
        backgroundColor: colors.bg.base
      }}
    />
  )
}
