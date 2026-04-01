import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfjs } from './pdf-worker-setup'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode, PdfNodeMeta } from '@shared/canvas-types'

interface PdfCardProps {
  readonly node: CanvasNode
}

export function PdfCard({ node }: PdfCardProps): React.ReactElement {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateNodeMetadata = useCanvasStore((s) => s.updateNodeMetadata)

  const meta = node.metadata as unknown as PdfNodeMeta
  const src = meta.src || ''
  const currentPage = meta.currentPage || 1
  const pageCount = meta.pageCount || 0

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const title = useMemo(() => {
    if (!src) return 'PDF'
    const segments = src.split('/')
    return segments[segments.length - 1] ?? 'PDF'
  }, [src])

  const isRemote = src.startsWith('http://') || src.startsWith('https://')

  // Load PDF document via IPC binary read (local files) or URL (remote)
  useEffect(() => {
    if (!src) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early exit when no src
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    let cancelled = false

    const loadPdf = async (): Promise<void> => {
      let loadSource: string | { data: Uint8Array }

      if (isRemote) {
        loadSource = src
      } else {
        // Read local file via IPC and pass raw bytes to pdfjs
        const base64 = await window.api.fs.readBinary(src)
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        loadSource = { data: bytes }
      }

      const doc = await pdfjs.getDocument(loadSource).promise
      if (cancelled) {
        doc.destroy()
        return
      }
      setPdfDoc(doc)
      setLoading(false)
      if (doc.numPages !== pageCount) {
        updateNodeMetadata(node.id, { pageCount: doc.numPages })
      }
    }

    loadPdf().catch((err) => {
      if (cancelled) return
      setError(err?.message ?? 'Failed to load PDF')
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [src, isRemote, node.id, pageCount, updateNodeMetadata])

  // Render current page when container has non-zero dimensions.
  // Uses ResizeObserver to handle the case where the PDF loads before
  // the card has had its first layout pass (containerWidth would be 0).
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || containerWidth === 0) return

    let cancelled = false

    pdfDoc.getPage(currentPage).then((page) => {
      if (cancelled || !canvasRef.current) return

      const unscaledViewport = page.getViewport({ scale: 1 })
      const scale = containerWidth / unscaledViewport.width
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      page.render({ canvas: canvasRef.current, canvasContext: ctx, viewport }).promise.catch(() => {
        // Render cancelled or failed - ignore
      })
    })

    return () => {
      cancelled = true
    }
  }, [pdfDoc, currentPage, containerWidth])

  // Clean up document on unmount
  useEffect(() => {
    return () => {
      pdfDoc?.destroy()
    }
  }, [pdfDoc])

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      updateNodeMetadata(node.id, { currentPage: currentPage - 1 })
    }
  }, [currentPage, node.id, updateNodeMetadata])

  const goToNextPage = useCallback(() => {
    if (currentPage < pageCount) {
      updateNodeMetadata(node.id, { currentPage: currentPage + 1 })
    }
  }, [currentPage, pageCount, node.id, updateNodeMetadata])

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {/* Page navigation */}
        {pageCount > 1 && (
          <div
            className="flex items-center justify-center gap-2 py-1 flex-shrink-0"
            style={{
              borderBottom: `1px solid ${colors.border.subtle}`,
              fontSize: 11,
              color: colors.text.secondary
            }}
          >
            <button
              type="button"
              onClick={goToPrevPage}
              disabled={currentPage <= 1}
              style={{
                background: 'none',
                border: 'none',
                cursor: currentPage <= 1 ? 'default' : 'pointer',
                color: currentPage <= 1 ? colors.text.muted : colors.text.secondary,
                padding: '0 4px',
                fontSize: 11
              }}
            >
              {'<'}
            </button>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={goToNextPage}
              disabled={currentPage >= pageCount}
              style={{
                background: 'none',
                border: 'none',
                cursor: currentPage >= pageCount ? 'default' : 'pointer',
                color: currentPage >= pageCount ? colors.text.muted : colors.text.secondary,
                padding: '0 4px',
                fontSize: 11
              }}
            >
              {'>'}
            </button>
          </div>
        )}

        {/* Content area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden flex items-center justify-center"
          style={{ minHeight: 0 }}
        >
          <PdfContent src={src} loading={loading} error={error} canvasRef={canvasRef} />
        </div>
      </div>
    </CardShell>
  )
}

function PdfContent({
  src,
  loading,
  error,
  canvasRef
}: {
  readonly src: string
  readonly loading: boolean
  readonly error: string | null
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>
}): React.ReactElement {
  if (!src) {
    return (
      <div className="text-center" style={{ color: colors.text.muted }}>
        <span className="text-xs">No PDF source</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center" style={{ color: colors.text.muted }}>
        <div
          className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-1"
          style={{ borderColor: colors.accent.default, borderTopColor: 'transparent' }}
        />
        <span className="text-xs">Loading PDF...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center px-4" style={{ color: colors.text.muted }}>
        <span className="text-xs">{error}</span>
      </div>
    )
  }

  return (
    <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
  )
}

export default memo(PdfCard)
