import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { useInspector } from '../../claude-config/InspectorContext'
import { CardShell } from '../CardShell'
import { colors, typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeAgentCardProps {
  node: CanvasNode
}

const MODEL_COLORS: Record<string, string> = {
  opus: '#a78bfa',
  sonnet: '#38bdf8',
  haiku: '#34d399'
}

function modelColor(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return color
  }
  return colors.text.secondary
}

export function ClaudeAgentCard({ node }: ClaudeAgentCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    agentName?: string
    model?: string
    tools?: string[]
    description?: string
    instructionPreview?: string
  }

  const inspector = useInspector()
  const openInEditor = useCallback(() => {
    if (inspector) {
      inspector(node.content, meta.agentName ?? 'Agent')
    } else {
      useEditorStore.getState().openTab(node.content, meta.agentName ?? 'Agent')
      useViewStore.getState().setContentView('editor')
    }
  }, [node.content, meta.agentName, inspector])

  const name = meta.agentName || 'Unnamed Agent'
  const model = meta.model || ''
  const tools = meta.tools ?? []

  return (
    <CardShell
      node={node}
      title={name}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: '#f1f5f9' }}>
        {/* Header: Model + Tool count */}
        <div className="flex items-center justify-between">
          {model && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold"
              style={{
                backgroundColor: modelColor(model) + '25',
                color: modelColor(model)
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: modelColor(model) }}
              />
              {model}
            </span>
          )}
          {tools.length > 0 && (
            <span
              className="text-xs font-medium tabular-nums"
              style={{ color: '#94a3b8', fontFamily: typography.fontFamily.mono }}
            >
              {tools.length} tools
            </span>
          )}
        </div>

        {/* Description */}
        {meta.description && (
          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#cbd5e1' }}>
            {meta.description}
          </p>
        )}

        {/* Tool chips */}
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tools.slice(0, 6).map((tool) => (
              <span
                key={tool}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: '#a78bfa15',
                  color: '#c4b5fd',
                  fontFamily: typography.fontFamily.mono
                }}
              >
                {tool}
              </span>
            ))}
            {tools.length > 6 && (
              <span
                className="px-1.5 py-0.5 text-xs"
                style={{ color: '#94a3b8', fontFamily: typography.fontFamily.mono }}
              >
                +{tools.length - 6}
              </span>
            )}
          </div>
        )}

        {/* Instruction preview */}
        {meta.instructionPreview && (
          <p
            className="text-xs leading-relaxed line-clamp-2"
            style={{ color: '#64748b', fontFamily: typography.fontFamily.mono }}
          >
            {meta.instructionPreview}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeAgentCard
