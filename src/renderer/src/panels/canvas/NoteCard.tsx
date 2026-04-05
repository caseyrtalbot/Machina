import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { logError } from '../../utils/error-logger'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { CardShell } from './CardShell'
import { markdownToHtml } from './shared/markdown-html'
import { CardBadge } from './shared/CardBadge'
import { MetadataGrid } from './shared/MetadataGrid'
import { frontmatterToEntries } from './shared/frontmatter-utils'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { vaultEvents } from '@engine/vault-event-hub'

interface NoteCardProps {
  node: CanvasNode
}

export function NoteCard({ node }: NoteCardProps) {
  const [body, setBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const removeNode = useCanvasStore((s) => s.removeNode)
  // The node.content holds the vault file path
  const filePath = node.content
  const artifactId = useVaultStore((s) => s.fileToId[filePath])
  const artifact = useStoreWithEqualityFn(
    useVaultStore,
    (s) => (artifactId ? s.artifactById[artifactId] : undefined),
    (a, b) =>
      a?.id === b?.id &&
      a?.title === b?.title &&
      a?.type === b?.type &&
      a?.frontmatter === b?.frontmatter
  )
  const title = artifact?.title ?? filePath.split('/').pop()?.replace('.md', '') ?? 'Note'

  // Build metadata entries from artifact frontmatter (single source of truth)
  const metadataEntries = useMemo(
    () => (artifact ? frontmatterToEntries(artifact.frontmatter) : []),
    [artifact]
  )

  // Display type badge from artifact type
  const badgeLabel = artifact?.type?.toUpperCase() ?? 'NOTE'

  const html = useMemo(() => (body ? markdownToHtml(body) : ''), [body])

  // CMD+click on wikilinks in static HTML
  const handleWikilinkClick = useCallback((e: React.MouseEvent) => {
    if (!e.metaKey) return
    const el = (e.target as HTMLElement).closest('[data-wikilink-target]')
    if (!el) return
    const linkTarget = el.getAttribute('data-wikilink-target')
    if (linkTarget) {
      useCanvasStore.getState().openSplit(linkTarget)
    }
  }, [])

  // Load file content
  useEffect(() => {
    if (!filePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early exit when no file to load
      setLoading(false)
      return
    }
    setLoading(true)
    window.api.fs
      .readFile(filePath)
      .then((content: string) => {
        // Strip frontmatter for display
        const fmEnd = content.indexOf('---', content.indexOf('---') + 3)
        const bodyStart = fmEnd > 0 ? fmEnd + 3 : 0
        setBody(content.slice(bodyStart).trim())
        setLoading(false)
      })
      .catch(() => {
        setBody('Failed to load note')
        setLoading(false)
      })
  }, [filePath])

  // Re-read on vault file changes (reactive)
  useEffect(() => {
    const unsub = vaultEvents.subscribePath(filePath, (data) => {
      if (data.event === 'change') {
        window.api.fs
          .readFile(filePath)
          .then((content: string) => {
            const fmEnd = content.indexOf('---', content.indexOf('---') + 3)
            const bodyStart = fmEnd > 0 ? fmEnd + 3 : 0
            setBody(content.slice(bodyStart).trim())
          })
          .catch((err) => logError('note-card-reload', err))
      }
    })
    return () => {
      unsub()
    }
  }, [filePath])

  // Auto-scroll past badge + metadata to reveal the title on first load
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolled = useRef(false)

  useEffect(() => {
    if (loading || !html || hasAutoScrolled.current) return
    hasAutoScrolled.current = true
    // Double-rAF: first lets React commit, second ensures paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        const prose = el.querySelector('.canvas-prose')
        if (prose instanceof HTMLElement) {
          const containerRect = el.getBoundingClientRect()
          const proseRect = prose.getBoundingClientRect()
          el.scrollTop += proseRect.top - containerRect.top - 8
        }
      })
    })
  }, [loading, html])

  // Render mermaid diagrams into the HTML string via state (not DOM mutation).
  // DOM mutation gets wiped by React re-renders; state-based approach is stable.
  const [mermaidSvgs, setMermaidSvgs] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!html) return
    // Check for mermaid blocks without touching the DOM
    if (!html.includes('language-mermaid')) return

    let cancelled = false
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const codeBlocks = doc.querySelectorAll('pre > code.language-mermaid')
    if (codeBlocks.length === 0) return

    import('mermaid').then(async ({ default: mermaid }) => {
      if (cancelled) return
      mermaid.initialize({ startOnLoad: false, theme: 'dark' })
      const svgs: Record<number, string> = {}

      for (let i = 0; i < codeBlocks.length; i++) {
        if (cancelled) break
        const source = codeBlocks[i].textContent ?? ''
        if (!source.trim()) continue
        try {
          const id = `mermaid-notecard-${node.id}-${i}`
          const { svg } = await mermaid.render(id, source)
          svgs[i] = svg
        } catch {
          // Leave as source code
        }
      }

      if (!cancelled && Object.keys(svgs).length > 0) {
        setMermaidSvgs(svgs)
      }
    })

    return () => {
      cancelled = true
    }
  }, [html, node.id])

  // Merge rendered mermaid SVGs back into the HTML string
  const processedHtml = useMemo(() => {
    if (!html || Object.keys(mermaidSvgs).length === 0) return html
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const codeBlocks = doc.querySelectorAll('pre > code.language-mermaid')
    codeBlocks.forEach((codeEl, i) => {
      if (mermaidSvgs[i] && codeEl.parentElement) {
        const wrapper = doc.createElement('div')
        wrapper.className = 'mermaid-rendered'
        wrapper.style.cssText = 'width: 100%; overflow-x: auto;'
        wrapper.innerHTML = mermaidSvgs[i]
        codeEl.parentElement.replaceWith(wrapper)
      }
    })
    return doc.body.innerHTML
  }, [html, mermaidSvgs])

  const openInEditor = useCallback(() => {
    useCanvasStore.getState().openSplit(filePath)
  }, [filePath])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      useCanvasStore.getState().setCardContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId: node.id
      })
    },
    [node.id]
  )

  return (
    <CardShell
      node={node}
      title={title}
      filePath={filePath}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={scrollRef}
        className="h-full overflow-auto canvas-card-content"
        style={{ minHeight: 0 }}
      >
        {loading ? (
          <div style={{ padding: 28 }}>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Loading...
            </span>
          </div>
        ) : !body ? (
          <div style={{ padding: 28 }}>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Empty note
            </span>
          </div>
        ) : (
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{ marginBottom: 20 }}>
              <CardBadge label={badgeLabel} />
            </div>

            {metadataEntries.length > 0 && <MetadataGrid entries={metadataEntries} />}

            <div className="canvas-prose" onClick={handleWikilinkClick}>
              <div
                className="ProseMirror focus:outline-none"
                dangerouslySetInnerHTML={{ __html: processedHtml }}
              />
            </div>
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default memo(NoteCard)
