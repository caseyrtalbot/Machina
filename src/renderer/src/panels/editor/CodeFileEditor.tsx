import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { colors } from '../../design/tokens'
import { createEditorExtensions, detectLanguage } from '../canvas/shared/codemirror-setup'
import { useDocument } from '../../hooks/useDocument'

interface CodeFileEditorProps {
  readonly filePath: string
}

export function CodeFileEditor({ filePath }: CodeFileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isLocalEditRef = useRef(false)
  const mountedForPathRef = useRef<string | null>(null)

  const doc = useDocument(filePath)

  // Mount CodeMirror when content first arrives, or when path changes
  useEffect(() => {
    if (doc.content === null || doc.loading) return
    if (!containerRef.current) return
    if (mountedForPathRef.current === filePath && viewRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    let cancelled = false
    mountedForPathRef.current = filePath
    const contentToMount = doc.content

    async function mount() {
      if (cancelled || !containerRef.current) return

      const extensions = await createEditorExtensions(detectLanguage(filePath), {
        readOnly: false,
        onUpdate: (text) => {
          isLocalEditRef.current = true
          doc.update(text)
        },
        fontSize: '14px',
        contentPadding: '16px 0'
      })

      const state = EditorState.create({ doc: contentToMount, extensions })
      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
    }

    mount()

    return () => {
      cancelled = true
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      mountedForPathRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount when content first arrives or path changes
  }, [filePath, doc.content === null, doc.loading])

  // Handle external content changes
  useEffect(() => {
    if (!viewRef.current || doc.content === null) return
    if (isLocalEditRef.current) {
      isLocalEditRef.current = false
      return
    }

    const view = viewRef.current
    const currentContent = view.state.doc.toString()
    if (currentContent !== doc.content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: doc.content }
      })
    }
  }, [doc.content])

  const filename = filePath.split('/').pop() ?? filePath

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center px-4 py-2 text-xs shrink-0"
        style={{ color: colors.text.muted, borderBottom: `0.5px solid ${colors.border.default}` }}
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
