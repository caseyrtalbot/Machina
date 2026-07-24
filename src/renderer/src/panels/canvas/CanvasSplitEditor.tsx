import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCanvas } from './canvas-store-context'
import { createEditorExtensions, detectLanguage } from './shared/codemirror-setup'
import { useDocument } from '../../hooks/useDocument'

interface CanvasSplitEditorProps {
  readonly filePath: string
}

export function CanvasSplitEditor({ filePath }: CanvasSplitEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const closeSplit = useCanvas((s) => s.closeSplit)

  // All file I/O goes through DocumentManager
  const doc = useDocument(filePath)
  const isLocalEditRef = useRef(false)
  const mountedForPathRef = useRef<string | null>(null)

  // Mount CodeMirror when content first arrives, or when path changes
  useEffect(() => {
    // Wait for content to load from DocumentManager
    if (doc.content === null || doc.loading) return
    if (!containerRef.current) return
    // Already mounted for this path
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
        fontSize: '13px',
        contentPadding: '12px 0'
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount when content first arrives or path changes, not on every content update
  }, [filePath, doc.content === null, doc.loading])

  // Handle external content changes (not from our own edits)
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
  const dirPath = filePath.split('/').slice(-2, -1)[0] ?? ''

  return (
    <div className="te-cv-split-editor">
      {/* Conflict banner */}
      {doc.isConflict && (
        <div className="te-cv-split-conflict">
          <span className="te-cv-split-conflict__msg">File changed externally</span>
          <span className="te-cv-split-conflict__actions">
            <button
              className="te-cv-split-conflict__reload"
              onClick={() => doc.resolveConflict('disk')}
            >
              Reload
            </button>
            <button
              className="te-cv-split-conflict__keep"
              onClick={() => doc.resolveConflict('mine')}
            >
              Keep mine
            </button>
          </span>
        </div>
      )}
      {/* Header bar */}
      <div
        className="canvas-split-editor__header te-cv-split-editor__headerbar"
        data-testid="canvas-split-editor-header"
      >
        <div className="te-cv-split-editor__title">
          {dirPath && <span className="te-cv-split-editor__dir">{dirPath}/</span>}
          <span className="te-cv-split-editor__filename">{filename}</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            closeSplit()
          }}
          className="canvas-split-editor__close te-cv-split-close"
          title="Close split editor (Cmd+Shift+E)"
          aria-label="Close split editor"
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
      {/* Editor container */}
      <div ref={containerRef} className="te-cv-split-editor__body" />
    </div>
  )
}
