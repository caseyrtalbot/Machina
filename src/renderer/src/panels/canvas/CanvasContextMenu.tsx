import { useEffect, useRef } from 'react'
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
  Zap,
  type LucideIcon
} from 'lucide-react'
import { colors } from '../../design/tokens'
import { CARD_TYPE_INFO, type CanvasNodeType, type CanvasNode } from '@shared/canvas-types'

interface CanvasContextMenuProps {
  readonly x: number
  readonly y: number
  readonly onAddCard: (
    type: CanvasNodeType,
    overrides?: Partial<Pick<CanvasNode, 'content' | 'metadata'>>
  ) => void
  readonly onSpawnAgent?: () => void
  readonly onClose: () => void
}

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

const ICON_PX = 14

export function CanvasContextMenu({
  x,
  y,
  onAddCard,
  onSpawnAgent,
  onClose
}: CanvasContextMenuProps): React.ReactElement {
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

  const handleFilePickerAdd = (
    accept: string,
    type: CanvasNodeType,
    buildMeta: (path: string, name: string) => Record<string, unknown>
  ): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const filePath = window.api.getFilePath(file)
      if (filePath) {
        onAddCard(type, { metadata: buildMeta(filePath, file.name) })
      }
    }
    input.click()
  }

  const renderRow = (
    Icon: LucideIcon,
    label: string,
    shortcut: string | undefined,
    onClick: () => void,
    key: string
  ): React.ReactElement => (
    <button
      key={key}
      onClick={onClick}
      className="w-full text-left px-3 py-1 text-xs grid items-center gap-2 transition-colors"
      style={{
        color: colors.text.primary,
        gridTemplateColumns: `${ICON_PX + 4}px 1fr auto`
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = colors.accent.muted
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
      }}
    >
      <Icon size={ICON_PX} strokeWidth={1.75} style={{ color: colors.text.secondary }} />
      <span>{label}</span>
      <span
        className="font-mono"
        style={{
          color: colors.text.muted,
          fontSize: 10,
          letterSpacing: 0.3,
          minWidth: 16,
          textAlign: 'right'
        }}
      >
        {shortcut ?? ''}
      </span>
    </button>
  )

  return (
    <div
      ref={ref}
      data-testid="canvas-context-menu"
      className="fixed border py-1 z-50"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        borderColor: colors.border.default,
        borderRadius: 8,
        minWidth: 220,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}
    >
      {MENU_SECTIONS.map((section) => {
        const types = (
          Object.entries(CARD_TYPE_INFO) as [
            CanvasNodeType,
            (typeof CARD_TYPE_INFO)[CanvasNodeType]
          ][]
        ).filter(([, info]) => info.category === section.category)

        if (types.length === 0) return null

        return (
          <div key={section.category}>
            <div className="px-3 py-0.5 text-xs font-medium" style={{ color: colors.text.muted }}>
              {section.label}
            </div>
            {types.map(([type, info]) => {
              const Icon = TYPE_ICON[type]
              const shortcut = TYPE_SHORTCUT[type]
              const handle = (): void => {
                if (type === 'image') {
                  handleFilePickerAdd('image/*', 'image', (path, name) => ({
                    src: path,
                    alt: name
                  }))
                } else if (type === 'pdf') {
                  handleFilePickerAdd('.pdf,application/pdf', 'pdf', (path) => ({
                    src: path,
                    pageCount: 0,
                    currentPage: 1
                  }))
                } else {
                  onAddCard(type)
                }
              }
              return renderRow(Icon, info.label, shortcut, handle, type)
            })}
          </div>
        )
      })}
      {onSpawnAgent && (
        <>
          <div
            style={{
              height: 1,
              backgroundColor: colors.border.subtle,
              margin: '4px 8px'
            }}
          />
          {renderRow(
            Zap,
            'Spawn Claude Session',
            undefined,
            () => {
              onSpawnAgent()
              onClose()
            },
            'spawn-agent'
          )}
        </>
      )}
    </div>
  )
}
