import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { borderRadius, colors } from '../../design/tokens'
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'
import { useUiStore } from '../../store/ui-store'

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
  { id: 'new-folder', label: 'New folder', separator: true },
  { id: 'map-to-canvas', label: 'Map to Canvas', separator: true },
  { id: 'copy-path', label: 'Copy path', separator: true },
  { id: 'reveal-finder', label: 'Reveal in Finder', separator: true },
  { id: 'rename', label: 'Rename...' },
  { id: 'delete', label: 'Delete', danger: true }
]

/** Returns multi-select action list with count baked into labels. */
function multiFileActions(count: number): readonly ContextMenuAction[] {
  return [
    { id: 'multi-add-to-canvas', label: `Add ${count} files to Canvas`, separator: true },
    { id: 'multi-copy-paths', label: `Copy ${count} paths`, separator: true },
    { id: 'multi-delete', label: `Delete ${count} files`, danger: true }
  ]
}

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
  const agentModifiedPaths = useSidebarSelectionStore((s) => s.agentModifiedPaths)

  const isBookmarked = useUiStore((s) => (state ? s.bookmarkedPaths.includes(state.path) : false))
  const selectedPaths = useSidebarSelectionStore((s) => s.selectedPaths)

  // Multi-select: if right-clicked path is in a selection of 2+, show bulk menu
  const isMultiSelect =
    state !== null && !state.isDirectory && selectedPaths.size >= 2 && selectedPaths.has(state.path)

  const actions = useMemo(() => {
    if (isMultiSelect) return multiFileActions(selectedPaths.size)
    if (state?.isDirectory) return FOLDER_ACTIONS
    const bookmarkAction: ContextMenuAction = {
      id: 'toggle-bookmark',
      label: isBookmarked ? 'Remove Bookmark' : 'Bookmark',
      shortcut: '⇧⌘D'
    }
    const base: readonly ContextMenuAction[] = [bookmarkAction, ...FILE_ACTIONS]
    const isAgentModified = state ? agentModifiedPaths.has(state.path) : false
    if (!isAgentModified) return base
    return [
      ...base.slice(0, -1),
      { id: 'mark-reviewed', label: 'Mark as Reviewed', separator: true },
      base[base.length - 1]
    ]
  }, [state, agentModifiedPaths, isBookmarked, isMultiSelect, selectedPaths.size])

  const entries = useMemo<readonly ContextMenuEntry[]>(() => {
    if (!state) return []
    return actions.flatMap((action): readonly ContextMenuEntry[] => {
      const item: ContextMenuEntry = {
        id: action.id,
        label: action.label,
        shortcut: action.shortcut,
        destructive: action.danger,
        onSelect: () => onAction(action.id, state.path)
      }
      return action.separator ? [item, { kind: 'separator', id: `${action.id}-sep` }] : [item]
    })
  }, [actions, onAction, state])

  if (!state) return null

  return (
    <ContextMenu
      position={{ x: state.x, y: state.y }}
      items={entries}
      onClose={onClose}
      openUpward
      minWidth={180}
    />
  )
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
      className="w-full bg-transparent text-sm px-1 py-0.5"
      style={{
        borderRadius: borderRadius.inline,
        color: colors.text.primary,
        border: `1px solid ${colors.accent.default}`,
        backgroundColor: colors.bg.base
      }}
    />
  )
}
