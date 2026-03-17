import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { useInspector } from '../../claude-config/InspectorContext'
import { CardShell } from '../CardShell'
import { typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeSkillCardProps {
  node: CanvasNode
}

export function ClaudeSkillCard({ node }: ClaudeSkillCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    skillName?: string
    description?: string
    refCount?: number
    promptCount?: number
  }

  const inspector = useInspector()
  const openInEditor = useCallback(() => {
    if (inspector) {
      inspector(node.content, meta.skillName ?? 'Skill')
    } else {
      useEditorStore.getState().openTab(node.content, meta.skillName ?? 'Skill')
      useViewStore.getState().setContentView('editor')
    }
  }, [node.content, meta.skillName, inspector])

  return (
    <CardShell
      node={node}
      title={meta.skillName || 'Unnamed Skill'}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: '#f1f5f9' }}>
        {/* Skill name + badge */}
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: '#22d3ee', fontFamily: typography.fontFamily.mono }}
          >
            {meta.skillName || 'skill'}
          </span>
          {(meta.promptCount ?? 0) > 0 && (
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              {meta.promptCount} prompts
            </span>
          )}
          {(meta.refCount ?? 0) > 0 && (
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              {meta.refCount} refs
            </span>
          )}
        </div>

        {/* Description - truncated for card view */}
        {meta.description && (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: '#cbd5e1' }}>
            {meta.description}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeSkillCard
