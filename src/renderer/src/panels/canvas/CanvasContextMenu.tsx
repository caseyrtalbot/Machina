import { useEffect, useRef } from 'react'
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

// Group card types by category for the menu
const MENU_SECTIONS: { label: string; category: 'content' | 'media' | 'tools' }[] = [
  { label: 'Content', category: 'content' },
  { label: 'Media', category: 'media' },
  { label: 'Tools', category: 'tools' }
]

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
  ) => {
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
        minWidth: 180,
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
            {types.map(([type, info]) => (
              <button
                key={type}
                onClick={() => {
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
                }}
                className="w-full text-left px-3 py-1 text-xs flex items-center gap-1.5 transition-colors"
                style={{ color: colors.text.primary }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = colors.accent.muted
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                <span
                  className="inline-flex items-center justify-center text-xs font-mono"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    backgroundColor: colors.bg.surface,
                    color: colors.text.secondary
                  }}
                >
                  {info.icon}
                </span>
                {info.label}
              </button>
            ))}
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
          <button
            onClick={() => {
              onSpawnAgent()
              onClose()
            }}
            className="w-full text-left px-3 py-1 text-xs flex items-center gap-1.5 transition-colors"
            style={{ color: colors.text.primary }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.backgroundColor = colors.accent.muted
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            }}
          >
            <span
              className="inline-flex items-center justify-center text-xs font-mono"
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                backgroundColor: colors.bg.surface,
                color: colors.text.secondary
              }}
            >
              {'⚡'}
            </span>
            Spawn Claude Session
          </button>
        </>
      )}
    </div>
  )
}
