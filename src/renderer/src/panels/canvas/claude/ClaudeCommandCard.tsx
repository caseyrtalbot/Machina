import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { CardShell } from '../CardShell'
import { colors, typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeCommandCardProps {
  node: CanvasNode
}

export function ClaudeCommandCard({ node }: ClaudeCommandCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    commandName?: string
    description?: string
  }

  const name = meta.commandName || 'command'

  const openInEditor = useCallback(() => {
    useEditorStore.getState().openTab(node.content, name)
    useViewStore.getState().setContentView('editor')
  }, [node.content, name])

  return (
    <CardShell
      node={node}
      title={`/${name}`}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-2" style={{ color: "#f1f5f9" }}>
        {/* Slash command visual */}
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

        {/* Description */}
        {meta.description && (
          <p className="text-xs leading-relaxed" style={{ color: "#cbd5e1" }}>
            {meta.description}
          </p>
        )}
      </div>
    </CardShell>
  )
}

export default ClaudeCommandCard
