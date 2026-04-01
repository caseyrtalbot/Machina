import { useEffect, useRef } from 'react'
import { colors } from '../../design/tokens'

interface CardContextMenuProps {
  readonly x: number
  readonly y: number
  readonly onShowConnections: () => void
  readonly onOpenInEditor?: () => void
  readonly onRunClaude?: () => void
  readonly onCopyPath: () => void
  readonly onClose: () => void
}

interface MenuItemProps {
  readonly label: string
  readonly onClick: () => void
}

function MenuItem({ label, onClick }: MenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="w-full text-left px-3 py-1 text-xs transition-colors"
      style={{ color: colors.text.primary }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = colors.accent.muted
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

export function CardContextMenu({
  x,
  y,
  onShowConnections,
  onOpenInEditor,
  onRunClaude,
  onCopyPath,
  onClose
}: CardContextMenuProps) {
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

  return (
    <div
      ref={ref}
      data-testid="card-context-menu"
      className="fixed border py-1 z-50"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        borderColor: colors.border.default,
        borderRadius: 8,
        minWidth: 180,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        label="Show Connections"
        onClick={() => {
          onShowConnections()
          onClose()
        }}
      />
      {onOpenInEditor && (
        <MenuItem
          label="Open in Editor"
          onClick={() => {
            onOpenInEditor()
            onClose()
          }}
        />
      )}
      {onRunClaude && (
        <MenuItem
          label="Run Claude on this note"
          onClick={() => {
            onRunClaude()
            onClose()
          }}
        />
      )}
      <div
        style={{
          height: 1,
          backgroundColor: colors.border.subtle,
          margin: '4px 8px'
        }}
      />
      <MenuItem
        label="Copy Path"
        onClick={() => {
          onCopyPath()
          onClose()
        }}
      />
    </div>
  )
}
