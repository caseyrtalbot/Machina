import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'

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
  const entries: readonly ContextMenuEntry[] = [
    ...(onQuickSaveText
      ? [{ id: 'quick-save', label: 'Save as new note', onSelect: onQuickSaveText }]
      : []),
    ...(onSaveTextAs ? [{ id: 'save-as', label: 'Save to...', onSelect: onSaveTextAs }] : []),
    ...(onQuickSaveText || onSaveTextAs ? [{ kind: 'separator', id: 'sep-save' } as const] : []),
    { id: 'show-connections', label: 'Show Connections', onSelect: onShowConnections },
    ...(onOpenInEditor
      ? [{ id: 'open-editor', label: 'Open in Editor', onSelect: onOpenInEditor }]
      : []),
    { kind: 'separator', id: 'sep-copy' } as const,
    { id: 'copy-path', label: 'Copy Path', onSelect: onCopyPath }
  ]

  return (
    <ContextMenu
      position={{ x, y }}
      items={entries}
      onClose={onClose}
      minWidth={180}
      testId="card-context-menu"
    />
  )
}
