import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu'

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
  if (actions.length === 0) return null

  const items: readonly ContextMenuItem[] = actions.map((action) => ({
    id: action.label,
    label: action.label,
    onSelect: action.onClick
  }))

  return <ContextMenu position={{ x, y }} items={items} onClose={onClose} />
}
