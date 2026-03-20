import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { useInspector } from '../../claude-config/InspectorContext'
import { CardShell } from '../CardShell'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeSettingsCardProps {
  node: CanvasNode
}

export function ClaudeSettingsCard({ node }: ClaudeSettingsCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    permissionCount?: number
    envVarCount?: number
    pluginNames?: string[]
  }

  const inspector = useInspector()
  const openInEditor = useCallback(() => {
    if (inspector) {
      inspector(node.content, 'Claude Settings')
    } else {
      useEditorStore.getState().openTab(node.content, 'Claude Settings')
      useViewStore.getState().setContentView('editor')
    }
  }, [node.content, inspector])

  const pluginCount = meta.pluginNames?.length ?? 0

  return (
    <CardShell
      node={node}
      title="Claude Settings"
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ color: '#f1f5f9' }}>
        <span
          className="px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: '#f59e0b22', color: '#f59e0b' }}
        >
          settings.json
        </span>
        <span className="text-xs" style={{ color: '#94a3b8' }}>
          Permissions:{' '}
          <span className="font-medium" style={{ color: '#f59e0b' }}>
            {meta.permissionCount ?? 0}
          </span>
        </span>
        <span className="text-xs" style={{ color: '#64748b' }}>
          ·
        </span>
        <span className="text-xs" style={{ color: '#94a3b8' }}>
          Env Vars:{' '}
          <span className="font-medium" style={{ color: '#3b82f6' }}>
            {meta.envVarCount ?? 0}
          </span>
        </span>
        {pluginCount > 0 && (
          <>
            <span className="text-xs" style={{ color: '#64748b' }}>
              ·
            </span>
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              MCP:{' '}
              <span className="font-medium" style={{ color: '#22d3ee' }}>
                {pluginCount}
              </span>
            </span>
          </>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeSettingsCard
