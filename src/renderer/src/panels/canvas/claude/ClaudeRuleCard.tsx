import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { CardShell } from '../CardShell'
import { colors, typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeRuleCardProps {
  node: CanvasNode
}

export function ClaudeRuleCard({ node }: ClaudeRuleCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    category?: string
    contentPreview?: string
  }

  const title = node.content.split('/').pop()?.replace('.md', '') ?? 'Rule'

  const openInEditor = useCallback(() => {
    useEditorStore.getState().openTab(node.content, title)
    useViewStore.getState().setContentView('editor')
  }, [node.content, title])

  return (
    <CardShell
      node={node}
      title={title}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: "#f1f5f9" }}>
        {/* Category badge */}
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: '#94a3b822', color: '#94a3b8' }}
        >
          {meta.category || 'global'}
        </span>

        {/* Content preview */}
        {meta.contentPreview && (
          <p
            className="text-xs leading-relaxed line-clamp-3"
            style={{ color: "#94a3b8", fontFamily: typography.fontFamily.mono }}
          >
            {meta.contentPreview}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeRuleCard
