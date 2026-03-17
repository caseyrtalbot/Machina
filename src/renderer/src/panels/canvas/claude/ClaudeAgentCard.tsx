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
        {/* Model badge */}
        {model && (
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: modelColor(model) + '22',
              color: modelColor(model)
            }}
          >
            {model}
          </span>
        )}

        {/* Description */}
        {meta.description && (
          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#cbd5e1' }}>
            {meta.description}
          </p>
        )}

        {/* Tools */}
        {tools.length > 0 && (
          <div>
            <span className="block mb-1" style={{ ...typography.metadata, color: '#94a3b8' }}>
              TOOLS
            </span>
            <div className="flex flex-wrap gap-1">
              {tools.slice(0, 8).map((tool) => (
                <span
                  key={tool}
                  className="px-1.5 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: colors.bg.elevated,
                    color: '#cbd5e1',
                    fontFamily: typography.fontFamily.mono
                  }}
                >
                  {tool}
                </span>
              ))}
              {tools.length > 8 && (
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  +{tools.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Instruction preview */}
        {meta.instructionPreview && (
          <p
            className="text-xs leading-relaxed opacity-60 line-clamp-2"
            style={{ color: '#94a3b8', fontFamily: typography.fontFamily.mono }}
          >
            {meta.instructionPreview}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeAgentCard
