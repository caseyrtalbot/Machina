import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { useInspector } from '../../claude-config/InspectorContext'
import { CardShell } from '../CardShell'
import { typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeMemoryCardProps {
  node: CanvasNode
}

const MEMORY_TYPE_COLORS: Record<string, string> = {
  user: '#38bdf8',
  feedback: '#f59e0b',
  project: '#34d399',
  reference: '#a78bfa'
}

export function ClaudeMemoryCard({ node }: ClaudeMemoryCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    memoryName?: string
    memoryType?: string
    linkCount?: number
    description?: string
    contentPreview?: string
    scope?: string
  }

  const name = meta.memoryName || node.content.split('/').pop()?.replace('.md', '') || 'Memory'
  const memType = meta.memoryType || 'unknown'
  const typeColor = MEMORY_TYPE_COLORS[memType] ?? '#94a3b8'

  const inspector = useInspector()
  const openInEditor = useCallback(() => {
    if (inspector) {
      inspector(node.content, name)
    } else {
      useEditorStore.getState().openTab(node.content, name)
      useViewStore.getState().setContentView('editor')
    }
  }, [node.content, name, inspector])

  return (
    <CardShell
      node={node}
      title={name}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: '#f1f5f9' }}>
        {/* Memory type + scope badges */}
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: typeColor + '22', color: typeColor }}
          >
            {memType}
          </span>
          {meta.scope === 'project' && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: '#3b82f622', color: '#60a5fa' }}
            >
              PROJECT
            </span>
          )}
        </div>

        {/* Description or content preview */}
        {(meta.description || meta.contentPreview) && (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: '#cbd5e1' }}>
            {meta.description || meta.contentPreview}
          </p>
        )}

        {/* Link count */}
        {(meta.linkCount ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              Links:
            </span>
            <span
              className="text-xs font-medium"
              style={{ color: typeColor, fontFamily: typography.fontFamily.mono }}
            >
              {meta.linkCount}
            </span>
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeMemoryCard
