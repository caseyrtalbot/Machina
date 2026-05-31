import { useEffect, useRef } from 'react'
import { borderRadius, colors, floatingPanel } from '../../design/tokens'

interface CardContextMenuProps {
  readonly x: number
  readonly y: number
  readonly onShowConnections: () => void
  readonly onOpenInEditor?: () => void
  readonly onCopyPath: () => void
  readonly onClose: () => void
  readonly onQuickSaveText?: () => void
  readonly onSaveTextAs?: () => void
}

interface MenuItemProps {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
}

function MenuItem({ label, onClick, disabled }: MenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      className="w-full text-left px-3 py-1 text-xs transition-colors"
      style={{
        color: disabled ? colors.text.secondary : colors.text.primary,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-tint-text)'
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
  onCopyPath,
  onClose,
  onQuickSaveText,
  onSaveTextAs
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
        backgroundColor: floatingPanel.glass.popoverBg,
        borderColor: colors.border.default,
        borderRadius: borderRadius.card,
        minWidth: 180,
        boxShadow: floatingPanel.shadowCompact,
        backdropFilter: floatingPanel.glass.popoverBlur,
        WebkitBackdropFilter: floatingPanel.glass.popoverBlur
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {onQuickSaveText && (
        <MenuItem
          label="Save as new note"
          onClick={() => {
            onQuickSaveText()
            onClose()
          }}
        />
      )}
      {onSaveTextAs && (
        <MenuItem
          label="Save to..."
          onClick={() => {
            onSaveTextAs()
            onClose()
          }}
        />
      )}
      {(onQuickSaveText || onSaveTextAs) && (
        <div
          style={{
            height: 1,
            backgroundColor: colors.border.subtle,
            margin: '4px 8px'
          }}
        />
      )}
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
