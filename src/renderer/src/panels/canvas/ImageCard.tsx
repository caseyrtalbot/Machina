import { useState, useEffect, useMemo, memo } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode, ImageNodeMeta } from '@shared/canvas-types'

interface ImageCardProps {
  readonly node: CanvasNode
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
}

function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'image/png'
}

export function ImageCard({ node }: ImageCardProps): React.ReactElement {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const meta = node.metadata as unknown as ImageNodeMeta
  const src = meta.src || ''

  const title = useMemo(() => {
    if (meta.alt) return meta.alt
    if (!src) return 'Image'
    const segments = src.split('/')
    return segments[segments.length - 1] ?? 'Image'
  }, [src, meta.alt])

  // Determine if this is a remote URL or local file
  const isRemote =
    src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')

  // Load local files via IPC binary read -> blob URL
  useEffect(() => {
    if (!src || isRemote) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early exit when no local file to load
      setLoading(false)
      return
    }

    let revoked = false

    window.api.fs
      .readBinary(src)
      .then((base64) => {
        if (revoked) return
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: mimeFromPath(src) })
        const url = URL.createObjectURL(blob)
        setBlobUrl(url)
        setLoading(false)
      })
      .catch(() => {
        if (revoked) return
        setError(true)
        setLoading(false)
      })

    return () => {
      revoked = true
    }
  }, [src, isRemote])

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const displaySrc = isRemote ? src : blobUrl

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex items-center justify-center h-full p-2" style={{ minHeight: 0 }}>
        <ImageContent
          loading={loading}
          displaySrc={displaySrc}
          error={error}
          alt={meta.alt ?? ''}
          onError={() => setError(true)}
        />
      </div>
    </CardShell>
  )
}

function ImageContent({
  loading,
  displaySrc,
  error,
  alt,
  onError
}: {
  readonly loading: boolean
  readonly displaySrc: string | null
  readonly error: boolean
  readonly alt: string
  readonly onError: () => void
}): React.ReactElement {
  if (loading) {
    return (
      <div className="text-center" style={{ color: colors.text.muted }}>
        <div
          className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-1"
          style={{ borderColor: colors.accent.default, borderTopColor: 'transparent' }}
        />
        <span className="text-xs">Loading...</span>
      </div>
    )
  }

  if (!displaySrc) {
    return (
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
    )
  }

  if (error) {
    return (
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
    )
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className="max-w-full max-h-full"
      style={{ objectFit: 'contain' }}
      onError={onError}
      draggable={false}
    />
  )
}

export default memo(ImageCard)
