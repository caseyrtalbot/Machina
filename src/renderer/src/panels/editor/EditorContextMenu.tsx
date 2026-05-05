import { useEffect, useRef } from 'react'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'

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
    // Console-direction: hairline border, near-square corners, mono labels.
    <div
      ref={menuRef}
      className="fixed z-50 py-1 shadow-lg min-w-[160px]"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        border: `0.5px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="w-full text-left px-3 py-1.5 focus-ring interactive-hover"
          style={{
            color: colors.text.primary,
            fontFamily: typography.fontFamily.mono,
            fontSize: 12,
            transition: transitions.hover
          }}
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
