import { useEffect, useState } from 'react'
import { LoadingState } from '../../../components/emptystate/LoadingState'
import CodeBlock from '@tiptap/extension-code-block'
import type { ReactNodeViewProps } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { BACKGROUND, STRUCTURAL_COLORS } from '@renderer/design/themes'

// Mermaid is loaded on demand (~2MB). The module is cached after first import.
let mermaidModule: (typeof import('mermaid'))['default'] | null = null
let mermaidInitialized = false

async function loadMermaid(): Promise<(typeof import('mermaid'))['default']> {
  if (mermaidModule) return mermaidModule
  const { default: m } = await import('mermaid')
  mermaidModule = m
  return m
}

// Mermaid needs resolved hex strings at init time — it cannot parse CSS
// custom properties. Theme CSS vars are static at runtime on this dark-only
// app, so a one-shot getComputedStyle read matches the rest of the canvas/Pixi
// pattern. Fallback covers non-browser test environments.
function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function initMermaid(m: (typeof import('mermaid'))['default']): void {
  if (mermaidInitialized) return
  m.initialize({
    startOnLoad: false,
    theme: 'dark',
    darkMode: true,
    themeVariables: {
      primaryColor: resolveCssVar('--color-bg-elevated', BACKGROUND.elevated),
      primaryBorderColor: resolveCssVar('--color-border-default', STRUCTURAL_COLORS.border.default),
      primaryTextColor: resolveCssVar('--color-text-primary', STRUCTURAL_COLORS.text.primary),
      lineColor: resolveCssVar('--color-text-secondary', STRUCTURAL_COLORS.text.secondary),
      secondaryColor: resolveCssVar('--color-bg-surface', BACKGROUND.surface),
      tertiaryColor: resolveCssVar('--color-bg-elevated', BACKGROUND.elevated),
      fontFamily: 'var(--font-mono)',
      fontSize: '14px'
    }
  })
  mermaidInitialized = true
}

let renderCounter = 0

function MermaidDiagram({ code }: { code: string }): React.ReactElement {
  const [svgHtml, setSvgHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!code.trim()) return
    let cancelled = false

    setLoading(true)
    setSvgHtml(null)

    loadMermaid()
      .then((m) => {
        if (cancelled) return
        initMermaid(m)
        const id = `mermaid-${++renderCounter}`
        return m.render(id, code.trim())
      })
      .then((result) => {
        if (cancelled || !result) return
        // Strip mermaid's inline max-width and fixed dimensions so the
        // SVG scales responsively via CSS (viewBox handles aspect ratio).
        let svg = result.svg
        svg = svg.replace(/(<svg[^>]*?)\s+width="[^"]*"/i, '$1')
        svg = svg.replace(/(<svg[^>]*?)\s+height="[^"]*"/i, '$1')
        svg = svg.replace(/(<svg[^>]*?)\s+style="[^"]*"/i, '$1')
        setSvgHtml(svg)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <div className="mermaid-error">
        <span className="mermaid-error-label">Mermaid syntax error</span>
        <pre>{code}</pre>
      </div>
    )
  }

  if (loading || !svgHtml) {
    return (
      <div className="mermaid-diagram">
        <LoadingState label="Loading diagram…" padding={12} />
      </div>
    )
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svgHtml }} />
}

function MermaidCodeBlockView({ node }: ReactNodeViewProps): React.ReactElement {
  const language = (node.attrs as Record<string, string>).language

  if (language === 'mermaid') {
    return (
      <NodeViewWrapper className="mermaid-block" contentEditable={false}>
        <div className="mermaid-label">mermaid</div>
        <MermaidDiagram code={node.textContent} />
        {/* Hidden content keeps ProseMirror model in sync for serialization */}
        <div className="te-mermaidblock-hidden">
          <NodeViewContent />
        </div>
      </NodeViewWrapper>
    )
  }

  // Default code block rendering for non-mermaid languages
  return (
    <NodeViewWrapper>
      <pre className={language ? `language-${language}` : undefined}>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidCodeBlockView)
  }
})
