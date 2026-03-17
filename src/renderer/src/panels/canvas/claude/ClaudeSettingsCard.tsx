import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { CardShell } from '../CardShell'
import { colors, typography } from '../../../design/tokens'
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

  const openInEditor = useCallback(() => {
    useEditorStore.getState().openTab(node.content, 'Claude Settings')
    useViewStore.getState().setContentView('editor')
  }, [node.content])

  return (
    <CardShell
      node={node}
      title="Claude Settings"
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-3" style={{ color: "#f1f5f9" }}>
        {/* Hero label */}
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: '#f59e0b22', color: '#f59e0b' }}
          >
            settings.json
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatBadge label="Permissions" value={meta.permissionCount ?? 0} color="#f59e0b" />
          <StatBadge label="Env Vars" value={meta.envVarCount ?? 0} color="#3b82f6" />
        </div>

        {/* Plugins */}
        {meta.pluginNames && meta.pluginNames.length > 0 && (
          <div>
            <span
              className="block mb-1"
              style={{
                ...typography.metadata,
                color: "#94a3b8"
              }}
            >
              MCP SERVERS
            </span>
            <div className="flex flex-wrap gap-1">
              {meta.pluginNames.map((name) => (
                <span
                  key={name}
                  className="px-1.5 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: colors.bg.elevated,
                    color: "#cbd5e1",
                    fontFamily: typography.fontFamily.mono
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </CardShell>
  )
}

function StatBadge({
  label,
  value,
  color
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div
      className="flex flex-col items-center p-2 rounded"
      style={{ backgroundColor: color + '11' }}
    >
      <span className="text-lg font-semibold" style={{ color }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: "#94a3b8" }}>
        {label}
      </span>
    </div>
  )
}

export default ClaudeSettingsCard
