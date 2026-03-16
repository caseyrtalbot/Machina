import { useState, useRef, useEffect, useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface TextCardProps {
  node: CanvasNode
}

export function TextCard({ node }: TextCardProps) {
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const removeNode = useCanvasStore((s) => s.removeNode)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  const handleBlur = useCallback(() => {
    setEditing(false)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditing(false)
    }
    // Stop propagation so canvas shortcuts don't fire during editing
    e.stopPropagation()
  }, [])

  return (
    <CardShell
      node={node}
      title={node.content.split('\n')[0]?.slice(0, 30) || 'Text'}
      onClose={() => removeNode(node.id)}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          value={node.content}
          onChange={(e) => updateContent(node.id, e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full h-full resize-none bg-transparent outline-none p-3 text-sm"
          style={{
            color: colors.text.primary,
            fontFamily: 'Inter, system-ui, sans-serif'
          }}
        />
      ) : (
        <div
          className="p-3 text-sm whitespace-pre-wrap cursor-text min-h-[2em]"
          style={{ color: colors.text.primary }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
        >
          {node.content || (
            <span style={{ color: colors.text.muted }}>Double-click to edit...</span>
          )}
        </div>
      )}
    </CardShell>
  )
}

export default TextCard
