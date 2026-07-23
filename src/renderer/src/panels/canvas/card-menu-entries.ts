import type { ContextMenuEntry } from '../../components/ContextMenu'

export interface CardMenuHandlers {
  readonly onShowConnections: () => void
  readonly onOpenInEditor?: () => void
  readonly onCopyPath: () => void
  readonly onQuickSaveText?: () => void
  readonly onSaveTextAs?: () => void
}

/** Right-click menu for a canvas card; optional handlers gate their items. */
export function cardMenuEntries({
  onShowConnections,
  onOpenInEditor,
  onCopyPath,
  onQuickSaveText,
  onSaveTextAs
}: CardMenuHandlers): readonly ContextMenuEntry[] {
  return [
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
}
