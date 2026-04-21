import { useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { getCanvasEditorExtensions } from './shared/tiptap-config'
import { colors } from '../../design/tokens'
import type { CanvasNode, MarkdownNodeMeta } from '@shared/canvas-types'

interface MarkdownCardProps {
  node: CanvasNode
}

export function MarkdownCard({ node }: MarkdownCardProps) {
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const updateMetadata = useCanvasStore((s) => s.updateNodeMetadata)
  const removeNode = useCanvasStore((s) => s.removeNode)

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
        class: 'focus:outline-none min-h-full px-3 py-2',
        style: `color: ${colors.text.primary}; font-size: 13px;`
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
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {/* Mode toggle bar */}
        <div
          className="flex items-center justify-between px-2 py-1 shrink-0"
          style={{ borderBottom: `1px solid ${colors.border.subtle}` }}
        >
          <span className="text-xs" style={{ color: colors.text.muted }}>
            {viewMode === 'rendered' ? 'Edit' : 'Source'}
          </span>
          <button
            onClick={toggleMode}
            className="text-xs px-2 py-0.5 rounded"
            style={{
              backgroundColor: colors.accent.muted,
              color: colors.text.secondary
            }}
            aria-label={viewMode === 'rendered' ? 'Switch to source view' : 'Switch to rendered view'}
          >
            {viewMode === 'rendered' ? '</>' : 'Aa'}
          </button>
        </div>

        {/* Editor content */}
        <div
          className="flex-1 overflow-auto"
          style={{ minHeight: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {editor && <EditorContent editor={editor} className="h-full" />}
        </div>
      </div>
    </CardShell>
  )
}

export default memo(MarkdownCard)
