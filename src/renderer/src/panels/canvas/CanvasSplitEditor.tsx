import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCanvasStore } from '../../store/canvas-store'
import { colors } from '../../design/tokens'
import { createEditorExtensions, detectLanguage } from './shared/codemirror-setup'
import { useDocument } from '../../hooks/useDocument'

interface CanvasSplitEditorProps {
  readonly filePath: string
}

export function CanvasSplitEditor({ filePath }: CanvasSplitEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const closeSplit = useCanvasStore((s) => s.closeSplit)

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
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      {/* Conflict banner */}
      {doc.isConflict && (
        <div
          className="flex items-center justify-between px-3 py-1.5 shrink-0"
          style={{
            backgroundColor: 'rgba(234, 179, 8, 0.12)',
            borderBottom: '1px solid rgba(234, 179, 8, 0.3)',
            color: '#eab308'
          }}
        >
          <span className="text-xs">File changed externally</span>
          <span className="flex gap-1.5">
            <button
              className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.2)',
                color: '#eab308',
                border: 'none'
              }}
              onClick={() => doc.resolveConflict('disk')}
            >
              Reload
            </button>
            <button
              className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                color: colors.text.secondary,
                border: 'none'
              }}
              onClick={() => doc.resolveConflict('mine')}
            >
              Keep mine
            </button>
          </span>
        </div>
      )}
      {/* Header bar */}
      <div
        className="canvas-split-editor__header flex items-center justify-between px-3 shrink-0"
        data-testid="canvas-split-editor-header"
        style={
          {
            height: 34,
            borderBottom: '1px solid var(--line-faint)',
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
            position: 'relative',
            zIndex: 60,
            WebkitAppRegion: 'drag'
          } as React.CSSProperties
        }
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {dirPath && (
            <span className="text-xs shrink-0" style={{ color: 'rgba(255, 255, 255, 0.25)' }}>
              {dirPath}/
            </span>
          )}
          <span
            className="text-xs truncate"
            style={{ color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}
          >
            {filename}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            closeSplit()
          }}
          className="canvas-split-editor__close flex items-center justify-center rounded cursor-pointer shrink-0"
          style={{
            width: 24,
            height: 24,
            color: colors.text.muted,
            opacity: 0.5,
            border: 'none',
            background: 'transparent',
            zIndex: 10
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.5'
          }}
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
      <div ref={containerRef} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />
    </div>
  )
}
