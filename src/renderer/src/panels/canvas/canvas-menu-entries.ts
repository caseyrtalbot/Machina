import {
  Code2,
  FileBox,
  FileText,
  Folder,
  Hash,
  Image as ImageIcon,
  Network,
  StickyNote,
  Terminal,
  TerminalSquare,
  Type,
  type LucideIcon
} from 'lucide-react'
import type { ContextMenuEntry } from '../../components/ContextMenu'
import { CARD_TYPE_INFO, type CanvasNodeType, type CanvasNode } from '@shared/canvas-types'

export type AddCardHandler = (
  type: CanvasNodeType,
  overrides?: Partial<Pick<CanvasNode, 'content' | 'metadata'>>
) => void

const MENU_SECTIONS: { label: string; category: 'content' | 'media' | 'tools' }[] = [
  { label: 'Content', category: 'content' },
  { label: 'Media', category: 'media' },
  { label: 'Tools', category: 'tools' }
]

const TYPE_ICON: Record<CanvasNodeType, LucideIcon> = {
  text: Type,
  code: Code2,
  markdown: Hash,
  note: StickyNote,
  image: ImageIcon,
  terminal: Terminal,
  pdf: FileText,
  'project-file': FileBox,
  'system-artifact': Network,
  'file-view': FileText,
  'project-folder': Folder,
  'terminal-block': TerminalSquare
}

// Single source of truth for canvas-menu shortcuts. Anything listed here must
// also be wired in use-canvas-keyboard-shortcuts.ts so the hint isn't a lie.
const TYPE_SHORTCUT: Partial<Record<CanvasNodeType, string>> = {
  note: 'N'
}

function pickFileAndAdd(
  accept: string,
  type: CanvasNodeType,
  onAddCard: AddCardHandler,
  buildMeta: (path: string, name: string) => Record<string, unknown>
): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const filePath = window.api.getFilePath(file)
    if (!filePath) return
    // Copy outside-vault picks into <vault>/assets/ so PathGuard-gated reads
    // succeed; in-vault picks come back unchanged. On failure fall back to
    // the original path and let the card surface the load error.
    let resolved = filePath
    try {
      resolved = (await window.api.vault.importAsset(filePath)).path
    } catch {
      /* keep original path */
    }
    onAddCard(type, { metadata: buildMeta(resolved, file.name) })
  }
  input.click()
}

/** "Add card" menu for right-clicks on empty canvas: sectioned card catalog. */
export function canvasAddCardEntries(onAddCard: AddCardHandler): readonly ContextMenuEntry[] {
  return MENU_SECTIONS.flatMap((section): readonly ContextMenuEntry[] => {
    const types = (
      Object.entries(CARD_TYPE_INFO) as [CanvasNodeType, (typeof CARD_TYPE_INFO)[CanvasNodeType]][]
    ).filter(([, info]) => info.category === section.category && info.creatableFromMenu)

    if (types.length === 0) return []

    const header: ContextMenuEntry = {
      kind: 'header',
      id: `header-${section.category}`,
      label: section.label
    }
    const items = types.map(
      ([type, info]): ContextMenuEntry => ({
        id: type,
        label: info.label,
        icon: TYPE_ICON[type],
        shortcut: TYPE_SHORTCUT[type],
        onSelect: () => {
          if (type === 'image') {
            pickFileAndAdd('image/*', 'image', onAddCard, (path, name) => ({
              src: path,
              alt: name
            }))
          } else if (type === 'pdf') {
            pickFileAndAdd('.pdf,application/pdf', 'pdf', onAddCard, (path) => ({
              src: path,
              pageCount: 0,
              currentPage: 1
            }))
          } else {
            onAddCard(type)
          }
        }
      })
    )
    return [header, ...items]
  })
}
