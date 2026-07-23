import type { ContextMenuEntry } from '../../components/ContextMenu'

interface FileMenuAction {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  /** Visual separator after this item */
  readonly separator?: boolean
  readonly danger?: boolean
}

const FILE_ACTIONS: readonly FileMenuAction[] = [
  { id: 'open-split', label: 'Open in Split', shortcut: '⌘\\', separator: true },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'copy-path', label: 'Copy path', separator: true },
  { id: 'open-default', label: 'Open in default app' },
  { id: 'reveal-finder', label: 'Reveal in Finder', separator: true },
  { id: 'rename', label: 'Rename...' },
  { id: 'delete', label: 'Delete', danger: true }
]

const FOLDER_ACTIONS: readonly FileMenuAction[] = [
  { id: 'new-file', label: 'New note in folder' },
  { id: 'new-folder', label: 'New folder', separator: true },
  { id: 'map-to-canvas', label: 'Map to Canvas', separator: true },
  { id: 'copy-path', label: 'Copy path', separator: true },
  { id: 'reveal-finder', label: 'Reveal in Finder', separator: true },
  { id: 'rename', label: 'Rename...' },
  { id: 'delete', label: 'Delete', danger: true }
]

/** Returns multi-select action list with count baked into labels. */
function multiFileActions(count: number): readonly FileMenuAction[] {
  return [
    { id: 'multi-add-to-canvas', label: `Add ${count} files to Canvas`, separator: true },
    { id: 'multi-copy-paths', label: `Copy ${count} paths`, separator: true },
    { id: 'multi-delete', label: `Delete ${count} files`, danger: true }
  ]
}

export interface FileMenuContext {
  readonly path: string
  readonly isDirectory: boolean
  readonly isBookmarked: boolean
  /** Right-clicked path is part of a 2+ selection. */
  readonly isMultiSelect: boolean
  readonly selectionCount: number
  readonly isAgentModified: boolean
  readonly onAction: (actionId: string, path: string) => void
}

/** File-tree right-click menu: file/folder/multi-select action sets. */
export function fileMenuEntries(ctx: FileMenuContext): readonly ContextMenuEntry[] {
  const actions = ((): readonly FileMenuAction[] => {
    if (ctx.isMultiSelect) return multiFileActions(ctx.selectionCount)
    if (ctx.isDirectory) return FOLDER_ACTIONS
    const bookmarkAction: FileMenuAction = {
      id: 'toggle-bookmark',
      label: ctx.isBookmarked ? 'Remove Bookmark' : 'Bookmark',
      shortcut: '⇧⌘D'
    }
    const base: readonly FileMenuAction[] = [bookmarkAction, ...FILE_ACTIONS]
    if (!ctx.isAgentModified) return base
    return [
      ...base.slice(0, -1),
      { id: 'mark-reviewed', label: 'Mark as Reviewed', separator: true },
      base[base.length - 1]
    ]
  })()

  return actions.flatMap((action): readonly ContextMenuEntry[] => {
    const item: ContextMenuEntry = {
      id: action.id,
      label: action.label,
      shortcut: action.shortcut,
      destructive: action.danger,
      onSelect: () => ctx.onAction(action.id, ctx.path)
    }
    return action.separator ? [item, { kind: 'separator', id: `${action.id}-sep` }] : [item]
  })
}
