import { useEffect, useRef } from 'react'
import { colors } from '../../design/tokens'
import { CARD_TYPE_INFO, type CanvasNodeType, type CanvasNode } from '@shared/canvas-types'

interface CanvasContextMenuProps {
  x: number
  y: number
  onAddCard: (
    type: CanvasNodeType,
    overrides?: Partial<Pick<CanvasNode, 'content' | 'metadata'>>
  ) => void
  onClose: () => void
}

// Group card types by category for the menu
const MENU_SECTIONS: { label: string; category: 'content' | 'media' | 'tools' }[] = [
  { label: 'Content', category: 'content' },
  { label: 'Media', category: 'media' },
  { label: 'Tools', category: 'tools' }
]

export function CanvasContextMenu({ x, y, onAddCard, onClose }: CanvasContextMenuProps) {
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

  const handleImageAdd = () => {
    // Use Electron file dialog to pick an image
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      // file.path is available in Electron's renderer
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        onAddCard('image', { metadata: { src: filePath, alt: file.name } })
      }
    }
    input.click()
  }

  return (
    <div
      ref={ref}
      className="fixed rounded-lg border shadow-lg py-1 z-50"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        borderColor: colors.border.default,
        minWidth: 180
      }}
    >
      {MENU_SECTIONS.map((section) => {
        const types = (Object.entries(CARD_TYPE_INFO) as [CanvasNodeType, typeof CARD_TYPE_INFO[CanvasNodeType]][])
          .filter(([, info]) => info.category === section.category)

        if (types.length === 0) return null

        return (
          <div key={section.category}>
            <div
              className="px-3 py-1 text-xs font-medium"
              style={{ color: colors.text.muted }}
            >
              {section.label}
            </div>
            {types.map(([type, info]) => (
              <button
                key={type}
                onClick={() => {
                  if (type === 'image') {
                    handleImageAdd()
                  } else {
                    onAddCard(type)
                  }
                }}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors"
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
                    width: 20,
                    height: 20,
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
    </div>
  )
}
