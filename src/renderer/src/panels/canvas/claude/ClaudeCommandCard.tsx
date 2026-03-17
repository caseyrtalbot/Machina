import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { useInspector } from '../../claude-config/InspectorContext'
import { CardShell } from '../CardShell'
import { typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeCommandCardProps {
  node: CanvasNode
}

export function ClaudeCommandCard({ node }: ClaudeCommandCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    commandName?: string
    description?: string
    contentPreview?: string
    scope?: string
  }

  const name = meta.commandName || 'command'

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
      title={`/${name}`}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: '#f1f5f9' }}>
        {/* Slash command visual + scope */}
        <div className="flex items-center gap-1.5">
          <div
            className="inline-block px-2 py-1 rounded text-sm font-medium"
            style={{
              backgroundColor: '#34d39922',
              color: '#34d399',
              fontFamily: typography.fontFamily.mono
            }}
          >
            /{name}
          </div>
          {meta.scope === 'project' && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: '#3b82f622', color: '#60a5fa' }}
            >
              PROJECT
            </span>
          )}
        </div>

        {/* Description or body preview */}
        {(meta.description || meta.contentPreview) && (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: '#cbd5e1' }}>
            {meta.description || meta.contentPreview}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeCommandCard
