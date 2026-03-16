import { useEffect, useRef } from 'react'
import { colors, transitions } from '../../design/tokens'

export interface ContextMenuAction {
  label: string
  onClick: () => void
}

interface EditorContextMenuProps {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

export function EditorContextMenu({ x, y, actions, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  if (actions.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-md shadow-lg min-w-[160px]"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="w-full text-left px-3 py-1.5 text-sm focus-ring interactive-hover"
          style={{ color: colors.text.primary, transition: transitions.hover }}
          onClick={() => {
            action.onClick()
            onClose()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
