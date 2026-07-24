import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { machinaCodeTheme } from './shared/code-theme'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { useCanvas } from './canvas-store-context'
import { CardShell } from './CardShell'
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
  const updateContent = useCanvas((s) => s.updateNodeContent)
  const updateMetadata = useCanvas((s) => s.updateNodeMetadata)
  const removeNode = useCanvas((s) => s.removeNode)

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
        machinaCodeTheme,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'var(--font-code)', overflow: 'auto' },
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
      <div className="te-codecard-root">
        {/* Language selector bar */}
        <div className="te-codecard-toolbar">
          <div className="te-codecard-lang">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowLangPicker(!showLangPicker)
              }}
              className="te-codecard-lang-btn"
            >
              {language}
            </button>
            {showLangPicker && (
              <div className="te-codecard-lang-menu">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleLanguageChange(lang)
                    }}
                    className="te-codecard-lang-option"
                    data-active={lang === language}
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
          className="te-codecard-editor-host"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </CardShell>
  )
}

export default memo(CodeCard)
