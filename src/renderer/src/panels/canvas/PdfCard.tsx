import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfjs } from './pdf-worker-setup'
import './pdf-text-layer.css'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors, borderRadius, typography, floatingPanel } from '../../design/tokens'
import { createQuoteCard } from './pdf-quote'
import { extractPdfPages } from '@shared/engine/pdf-extractor'
import { indexPdfInSearch } from '../../engine/vault-search'
import type { CanvasNode, PdfNodeMeta } from '@shared/canvas-types'

interface PdfCardProps {
  readonly node: CanvasNode
}

// US-letter aspect ratio as the placeholder height until a page reports its
// real dimensions; keeps continuous scroll stable while pages lazy-render.
const DEFAULT_PAGE_ASPECT = 11 / 8.5

interface QuoteSelection {
  readonly text: string
  readonly x: number
  readonly y: number
  /** 1-based page the selection starts on, when attributable. */
  readonly page?: number
}

/**
 * Extract per-page text and feed both search indexes (3.10a): the renderer
 * vault-worker SearchEngine (human search with page hints) and — for local
 * files — the main-process engine behind MCP search.query. Best-effort and
 * off the render path; a destroyed document mid-extraction simply rejects.
 */
async function indexPdfText(doc: PDFDocumentProxy, src: string, isRemote: boolean): Promise<void> {
  const pages = await extractPdfPages(doc)
  indexPdfInSearch(src, pages)
  if (!isRemote) {
    await window.api.vault.indexPdfContent(src, pages)
  }
}

/** Walk up from a selection endpoint to the enclosing page wrapper. */
function pageNumberForRange(range: Range): number | undefined {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  const page = Number(el?.closest('[data-page-number]')?.getAttribute('data-page-number'))
  return Number.isInteger(page) && page > 0 ? page : undefined
}

export function PdfCard({ node }: PdfCardProps): React.ReactElement {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateNodeMetadata = useCanvasStore((s) => s.updateNodeMetadata)
  const addNodesAndEdges = useCanvasStore((s) => s.addNodesAndEdges)

  const meta = node.metadata as unknown as PdfNodeMeta
  const src = meta.src || ''
  const pageCount = meta.pageCount || 0

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quoteSel, setQuoteSel] = useState<QuoteSelection | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

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
      // Non-blocking: text extraction feeds search (3.10a) but never gates
      // rendering. Failures (encrypted, destroyed mid-flight) are ignored.
      void indexPdfText(doc, src, isRemote).catch(() => {})
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

  // Clean up document on unmount
  useEffect(() => {
    return () => {
      pdfDoc?.destroy()
    }
  }, [pdfDoc])

  // Page width tracks the scroll container (ResizeObserver handles the case
  // where the PDF loads before the card's first layout pass).
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Text-layer selection -> floating "Quote to note" affordance
  const handleMouseUp = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!text || !sel || sel.rangeCount === 0) {
      setQuoteSel(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      setQuoteSel(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const page = pageNumberForRange(range)
    // Content coordinates (scroll-relative) so the button scrolls with the text
    setQuoteSel({
      text,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top + container.scrollTop,
      ...(page !== undefined ? { page } : {})
    })
  }, [])

  const handleQuoteToNote = useCallback(() => {
    if (!quoteSel) return
    const { node: quoteNode, edge } = createQuoteCard(node, quoteSel.text, quoteSel.page)
    addNodesAndEdges([quoteNode], [edge])
    window.getSelection()?.removeAllRanges()
    setQuoteSel(null)
  }, [quoteSel, node, addNodesAndEdges])

  const pageNumbers = useMemo(() => {
    const total = pdfDoc?.numPages ?? 0
    return Array.from({ length: total }, (_, i) => i + 1)
  }, [pdfDoc])

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {pageCount > 1 && (
          <div
            className="flex items-center justify-center py-1 flex-shrink-0"
            style={{
              borderBottom: `1px solid ${colors.border.subtle}`,
              fontSize: 11,
              color: colors.text.secondary,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {pageCount} pages
          </div>
        )}

        {/* Continuous-scroll page stack */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden relative"
          style={{ minHeight: 0 }}
          onMouseUp={handleMouseUp}
        >
          <PdfStatus src={src} loading={loading} error={error} />
          {pdfDoc &&
            containerWidth > 0 &&
            pageNumbers.map((pageNumber) => (
              <PdfPage
                key={pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                width={containerWidth}
              />
            ))}
          {quoteSel && (
            <button
              type="button"
              onMouseDown={(e) => {
                // Keep the text selection alive through the click
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                handleQuoteToNote()
              }}
              style={{
                position: 'absolute',
                top: Math.max(quoteSel.y - 30, 4),
                left: Math.max(quoteSel.x - 48, 4),
                zIndex: 3,
                padding: '3px 8px',
                fontSize: 10,
                fontFamily: typography.fontFamily.mono,
                textTransform: 'uppercase',
                letterSpacing: typography.metadata.letterSpacing,
                color: colors.accent.default,
                backgroundColor: floatingPanel.glass.popoverBg,
                border: `1px solid ${colors.accent.default}`,
                borderRadius: borderRadius.inline,
                boxShadow: floatingPanel.shadowCompact,
                cursor: 'pointer'
              }}
            >
              Quote to note
            </button>
          )}
        </div>
      </div>
    </CardShell>
  )
}

function PdfStatus({
  src,
  loading,
  error
}: {
  readonly src: string
  readonly loading: boolean
  readonly error: string | null
}): React.ReactElement | null {
  if (src && !loading && !error) return null
  return (
    <div
      className="flex items-center justify-center h-full text-center px-4"
      style={{ color: colors.text.muted }}
    >
      {!src ? (
        <span className="text-xs">No PDF source</span>
      ) : loading ? (
        <div>
          <div
            className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-1"
            style={{ borderColor: colors.accent.default, borderTopColor: 'transparent' }}
          />
          <span className="text-xs">Loading PDF...</span>
        </div>
      ) : (
        <span className="text-xs">{error}</span>
      )}
    </div>
  )
}

interface PdfPageProps {
  readonly pdfDoc: PDFDocumentProxy
  readonly pageNumber: number
  readonly width: number
}

/**
 * One page in the continuous scroll: a render canvas plus a pdfjs TextLayer
 * for selection/copy. Pages lazy-render when they near the scroll viewport
 * and stay rendered afterwards.
 */
function PdfPage({ pdfDoc, pageNumber, width }: PdfPageProps): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el || shouldRender) return
    // Pages are direct children of the card's scroll container
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShouldRender(true)
      },
      { root: el.parentElement, rootMargin: '300px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shouldRender])

  useEffect(() => {
    if (!shouldRender || width === 0) return
    const canvas = canvasRef.current
    const textDiv = textRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !textDiv || !wrapper) return

    let cancelled = false
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null =
      null

    pdfDoc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return
        const unscaled = page.getViewport({ scale: 1 })
        setAspect(unscaled.height / unscaled.width)
        const scale = width / unscaled.width
        const viewport = page.getViewport({ scale })

        // TextLayer span geometry is driven by --scale-factor (see pdf-text-layer.css)
        wrapper.style.setProperty('--scale-factor', String(scale))

        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        renderTask = page.render({ canvas, canvasContext: ctx, viewport })

        textDiv.replaceChildren()
        textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport
        })

        await Promise.all([renderTask.promise, textLayer.render()])
      })
      .catch(() => {
        // Render cancelled (unmount/resize) or failed - ignore
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [shouldRender, width, pageNumber, pdfDoc])

  return (
    <div
      ref={wrapperRef}
      className="te-pdf-page"
      data-page-number={pageNumber}
      style={{
        width: '100%',
        height: Math.round(width * (aspect ?? DEFAULT_PAGE_ASPECT)),
        borderBottom: `1px solid ${colors.border.subtle}`
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <div ref={textRef} className="te-pdf-textlayer" />
    </div>
  )
}

export default memo(PdfCard)
