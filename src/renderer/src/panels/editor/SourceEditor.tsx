import { useState, useEffect, useRef, useCallback } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { EditorContextMenu, type ContextMenuAction } from './EditorContextMenu'
import { colors } from '../../design/tokens'

interface SourceEditorProps {
  content: string
  onChange: (content: string) => void
}

export function SourceEditor({ content, onChange }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    actions: ContextMenuAction[]
  } | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const view = viewRef.current
    if (!view) return

    const { from, to } = view.state.selection.main
    if (from === to) return // no selection

    e.preventDefault()

    const selectedText = view.state.sliceDoc(from, to)

    // Check if selection is already wrapped in <node> tags
    const beforeStart = Math.max(0, from - 6)
    const afterEnd = Math.min(view.state.doc.length, to + 7)
    const surrounding = view.state.sliceDoc(beforeStart, afterEnd)
    const isConceptNode = surrounding.includes(`<node>${selectedText}</node>`)

    const actions: ContextMenuAction[] = isConceptNode
      ? [{
          label: 'Unlink concept',
          onClick: () => {
            const v = viewRef.current
            if (!v) return
            // Find and remove surrounding <node>...</node> tags
            const nodeStart = from - 6
            const nodeEnd = to + 7
            const full = v.state.sliceDoc(nodeStart, nodeEnd)
            if (full === `<node>${selectedText}</node>`) {
              v.dispatch({ changes: { from: nodeStart, to: nodeEnd, insert: selectedText } })
            }
          }
        }]
      : [{
          label: 'Link as concept',
          onClick: () => {
            const v = viewRef.current
            if (!v) return
            v.dispatch({
              changes: { from, to, insert: `<node>${selectedText}</node>` }
            })
          }
        }]

    setContextMenu({ x: e.clientX, y: e.clientY, actions })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        history(),
        markdown(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.domEventHandlers({
          contextmenu: (event) => {
            handleContextMenu(event)
            return false
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

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content }
      })
    }
  }, [content])

  return (
    <>
      <div
        ref={containerRef}
        className="h-full overflow-hidden"
        style={{ backgroundColor: colors.bg.base }}
      />
      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenu.actions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
