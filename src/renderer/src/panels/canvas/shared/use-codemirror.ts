import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'

interface UseCodeMirrorOptions {
  readonly initialContent: string
  readonly language?: Extension
  readonly readonly?: boolean
  readonly onChange?: (content: string) => void
}

export function useCodeMirrorEditor(opts: UseCodeMirrorOptions): {
  containerRef: React.RefObject<HTMLDivElement | null>
  view: EditorView | null
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(opts.onChange)
  const optsRef = useRef(opts)

  useEffect(() => {
    onChangeRef.current = opts.onChange
  }, [opts.onChange])

  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      history(),
      oneDark,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace' },
        '.cm-content': { padding: '8px 0' }
      })
    ]

    if (optsRef.current.language) {
      extensions.push(optsRef.current.language)
    }

    if (optsRef.current.readonly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString())
        }
      })
    )

    const state = EditorState.create({
      doc: optsRef.current.initialContent,
      extensions
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // eslint-disable-next-line react-hooks/refs -- viewRef is read during render to expose EditorView to consumers
  return { containerRef, view: viewRef.current }
}
