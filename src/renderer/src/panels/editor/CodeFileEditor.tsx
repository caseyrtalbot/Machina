import { useEffect, useRef, useCallback } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { colors } from '../../design/tokens'
import type { Extension } from '@codemirror/state'

interface CodeFileEditorProps {
  readonly filePath: string
}

function languageExtension(path: string): Extension {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
      return javascript({ jsx: ext === '.tsx', typescript: true })
    case '.js':
    case '.jsx':
      return javascript({ jsx: ext === '.jsx' })
    case '.py':
      return python()
    case '.json':
      return json()
    case '.html':
    case '.htm':
      return html()
    case '.css':
    case '.scss':
      return css()
    default:
      return []
  }
}

export function CodeFileEditor({ filePath }: CodeFileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentPathRef = useRef(filePath)

  const scheduleAutosave = useCallback((path: string, content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.api.fs.writeFile(path, content)
    }, 1000)
  }, [])

  // Destroy and recreate the editor when the file path changes
  useEffect(() => {
    if (!containerRef.current) return
    currentPathRef.current = filePath

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    let cancelled = false

    window.api.fs.readFile(filePath).then((content) => {
      if (cancelled || !containerRef.current) return

      const state = EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          history(),
          languageExtension(filePath),
          oneDark,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              scheduleAutosave(currentPathRef.current, update.state.doc.toString())
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace' },
            '.cm-content': { padding: '16px 0' }
          })
        ]
      })

      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
    })

    return () => {
      cancelled = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [filePath, scheduleAutosave])

  const filename = filePath.split('/').pop() ?? filePath

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center px-4 py-2 text-xs shrink-0"
        style={{ color: colors.text.muted, borderBottom: `1px solid ${colors.border.default}` }}
      >
        <span style={{ color: colors.text.primary }}>{filename}</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ backgroundColor: colors.bg.base }}
      />
    </div>
  )
}
