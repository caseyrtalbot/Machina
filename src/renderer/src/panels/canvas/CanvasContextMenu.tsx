import { useEffect, useRef } from 'react'
import { colors } from '../../design/tokens'

interface CanvasContextMenuProps {
  x: number
  y: number
  onAddCard: () => void
  onAddNote: () => void
  onAddTerminal: () => void
  onClose: () => void
}

export function CanvasContextMenu({
  x,
  y,
  onAddCard,
  onAddNote,
  onAddTerminal,
  onClose
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const items = [
    { label: 'Add card', action: onAddCard },
    { label: 'Add note from vault', action: onAddNote },
    { label: 'Add terminal', action: onAddTerminal }
  ]

  return (
    <div
      ref={ref}
      className="fixed rounded-lg border shadow-lg py-1 z-50"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        borderColor: colors.border.default,
        minWidth: 180
      }}
    >
      {items.map(({ label, action }) => (
        <button
          key={label}
          onClick={action}
          className="w-full text-left px-3 py-1.5 text-sm transition-colors"
          style={{ color: colors.text.primary }}
          onMouseEnter={(e) => {
            ;(e.target as HTMLElement).style.backgroundColor = colors.accent.muted
          }}
          onMouseLeave={(e) => {
            ;(e.target as HTMLElement).style.backgroundColor = 'transparent'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
