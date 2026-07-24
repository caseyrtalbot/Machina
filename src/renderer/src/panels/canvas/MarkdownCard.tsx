import { useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { useCanvas } from './canvas-store-context'
import { CardShell } from './CardShell'
import { getCanvasEditorExtensions } from './shared/tiptap-config'
import type { CanvasNode, MarkdownNodeMeta } from '@shared/canvas-types'

interface MarkdownCardProps {
  node: CanvasNode
}

export function MarkdownCard({ node }: MarkdownCardProps) {
  const updateContent = useCanvas((s) => s.updateNodeContent)
  const updateMetadata = useCanvas((s) => s.updateNodeMetadata)
  const removeNode = useCanvas((s) => s.removeNode)

  const meta = node.metadata as unknown as MarkdownNodeMeta
  const viewMode = meta.viewMode ?? 'rendered'

  const extensions = useMemo(() => getCanvasEditorExtensions(), [])

  // Debounce content saves
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guard: skip saves until initial content has been loaded into the editor.
  // Without this, Tiptap can fire onUpdate during creation with empty content,
  // and the debounced save overwrites the real content in the store.
  const initializedRef = useRef(false)

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed || !initializedRef.current) return
      const manager = ed.storage.markdown?.manager
      if (!manager) return
      const markdown = manager.serialize(ed.getJSON())

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateContent(node.id, markdown)
      }, 300)
    },
    [node.id, updateContent]
  )

  const editor = useEditor({
    extensions,
    content: '',
    editable: viewMode === 'rendered',
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: 'te-mdcard-editor'
      },
      handleDOMEvents: {
        keydown: (_view, e) => {
          e.stopPropagation()
          return false
        }
      }
    }
  })

  // Load initial content into Tiptap.
  // queueMicrotask defers setContent out of React's commit phase,
  // avoiding ProseMirror's internal flushSync collision.
  useEffect(() => {
    if (!editor) return
    queueMicrotask(() => {
      if (editor.isDestroyed) return
      const manager = editor.storage.markdown?.manager
      if (manager && node.content) {
        editor.commands.setContent(manager.parse(node.content), { emitUpdate: false })
      } else if (node.content) {
        editor.commands.setContent(node.content, { emitUpdate: false })
      }
      initializedRef.current = true
    })
  }, [editor, node.content])

  // Toggle editable when viewMode changes
  useEffect(() => {
    if (!editor) return
    editor.setEditable(viewMode === 'rendered')
  }, [editor, viewMode])

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const toggleMode = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      updateMetadata(node.id, {
        viewMode: viewMode === 'rendered' ? 'source' : 'rendered'
      })
    },
    [node.id, viewMode, updateMetadata]
  )

  const title = useMemo(() => {
    const firstLine = node.content.split('\n')[0]?.trim()
    if (firstLine && firstLine.startsWith('#')) {
      return firstLine.replace(/^#+\s*/, '').slice(0, 30)
    }
    return firstLine?.slice(0, 30) || 'Markdown'
  }, [node.content])

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="te-mdcard-root">
        {/* Mode toggle bar */}
        <div className="te-mdcard-toolbar">
          <span className="te-mdcard-mode-label">
            {viewMode === 'rendered' ? 'Edit' : 'Source'}
          </span>
          <button
            onClick={toggleMode}
            className="te-mdcard-mode-toggle"
            aria-label={
              viewMode === 'rendered' ? 'Switch to source view' : 'Switch to rendered view'
            }
          >
            {viewMode === 'rendered' ? '</>' : 'Aa'}
          </button>
        </div>

        {/* Editor content */}
        <div className="te-mdcard-editor-scroll" onClick={(e) => e.stopPropagation()}>
          {editor && <EditorContent editor={editor} className="te-mdcard-editor-host" />}
        </div>
      </div>
    </CardShell>
  )
}

export default memo(MarkdownCard)
