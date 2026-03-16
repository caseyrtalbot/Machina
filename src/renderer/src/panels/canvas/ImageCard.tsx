import { useState, useMemo } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode, ImageNodeMeta } from '@shared/canvas-types'

interface ImageCardProps {
  node: CanvasNode
}

export function ImageCard({ node }: ImageCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const [error, setError] = useState(false)

  const meta = node.metadata as unknown as ImageNodeMeta
  const src = meta.src || ''

  const title = useMemo(() => {
    if (meta.alt) return meta.alt
    if (!src) return 'Image'
    const segments = src.split('/')
    return segments[segments.length - 1] ?? 'Image'
  }, [src, meta.alt])

  // Resolve file:// for local paths, pass URLs through
  const resolvedSrc = useMemo(() => {
    if (!src) return ''
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return src
    }
    // Local file path: use file:// protocol (Electron supports this)
    return `file://${src}`
  }, [src])

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex items-center justify-center h-full p-2" style={{ minHeight: 0 }}>
        {!resolvedSrc ? (
          <div className="text-center" style={{ color: colors.text.muted }}>
            <svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto mb-2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="text-xs">No image source</span>
          </div>
        ) : error ? (
          <div className="text-center" style={{ color: colors.text.muted }}>
            <svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto mb-2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9l6 6M15 9l-6 6" />
            </svg>
            <span className="text-xs">Failed to load image</span>
          </div>
        ) : (
          <img
            src={resolvedSrc}
            alt={meta.alt ?? ''}
            className="max-w-full max-h-full"
            style={{ objectFit: 'contain' }}
            onError={() => setError(true)}
            draggable={false}
          />
        )}
      </div>
    </CardShell>
  )
}

export default ImageCard
