import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode, CodeNodeMeta } from '@shared/canvas-types'
import {
  LANGUAGES,
  loadLanguageExtension,
  type SupportedLanguage
} from './shared/codemirror-languages'

interface CodeCardProps {
  node: CanvasNode
}

export function CodeCard({ node }: CodeCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const updateMetadata = useCanvasStore((s) => s.updateNodeMetadata)
  const removeNode = useCanvasStore((s) => s.removeNode)

  const meta = node.metadata as unknown as CodeNodeMeta
  const language = (meta.language ?? 'typescript') as SupportedLanguage
  const [showLangPicker, setShowLangPicker] = useState(false)

  // Debounced content update
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef((content: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateContent(node.id, content)
    }, 300)
  })

  useEffect(() => {
    onChangeRef.current = (content: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateContent(node.id, content)
      }, 300)
    }
  }, [node.id, updateContent])

  // Build and rebuild editor when language changes
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    async function init() {
      const langExt = await loadLanguageExtension(language)
      if (cancelled) return

      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        history(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace', overflow: 'auto' },
          '.cm-content': { padding: '8px 0' }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        // Prevent canvas shortcuts while typing
        EditorView.domEventHandlers({
          keydown: (e) => {
            e.stopPropagation()
          }
        })
      ]

      if (langExt) extensions.push(langExt)

      const state = EditorState.create({
        doc: node.content,
        extensions
      })

      // Clean up previous editor if language changed
      if (viewRef.current) {
        viewRef.current.destroy()
      }

      if (!containerRef.current || cancelled) return
      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
    }

    init()

    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [language]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLanguageChange = useCallback(
    (lang: SupportedLanguage) => {
      updateMetadata(node.id, { language: lang })
      setShowLangPicker(false)
    },
    [node.id, updateMetadata]
  )

  const title = useMemo(() => {
    const filename = meta.filename
    if (filename) return filename
    return `Code (${language})`
  }, [meta.filename, language])

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {/* Language selector bar */}
        <div
          className="flex items-center px-2 py-1 shrink-0"
          style={{ borderBottom: `0.5px solid ${colors.border.subtle}` }}
        >
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowLangPicker(!showLangPicker)
              }}
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: colors.accent.muted,
                color: colors.text.secondary
              }}
            >
              {language}
            </button>
            {showLangPicker && (
              <div
                className="absolute top-full left-0 mt-1 rounded border shadow-lg py-1 z-50"
                style={{
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  minWidth: 120
                }}
              >
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleLanguageChange(lang)
                    }}
                    className="w-full text-left px-3 py-1 text-xs"
                    style={{
                      color: lang === language ? colors.accent.default : colors.text.secondary,
                      backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      ;(e.target as HTMLElement).style.backgroundColor = colors.accent.muted
                    }}
                    onMouseLeave={(e) => {
                      ;(e.target as HTMLElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CodeMirror container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden"
          style={{ minHeight: 0 }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </CardShell>
  )
}

export default memo(CodeCard)
