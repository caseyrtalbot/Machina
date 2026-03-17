import { useCallback } from 'react'
import { useCanvasStore } from '../../../store/canvas-store'
import { useEditorStore } from '../../../store/editor-store'
import { useViewStore } from '../../../store/view-store'
import { CardShell } from '../CardShell'
import { colors, typography } from '../../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface ClaudeTeamCardProps {
  node: CanvasNode
}

const MEMBER_COLORS = [
  '#a78bfa', '#38bdf8', '#34d399', '#f472b6',
  '#f59e0b', '#22d3ee', '#ef4444', '#818cf8'
]

export function ClaudeTeamCard({ node }: ClaudeTeamCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const meta = node.metadata as {
    teamName?: string
    memberCount?: number
    leadAgentId?: string | null
    members?: string[]
  }

  const name = meta.teamName || 'Unnamed Team'

  const openInEditor = useCallback(() => {
    useEditorStore.getState().openTab(node.content, name)
    useViewStore.getState().setContentView('editor')
  }, [node.content, name])

  const members = meta.members ?? []

  return (
    <CardShell
      node={node}
      title={name}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="p-3 space-y-3" style={{ color: "#f1f5f9" }}>
        {/* Team badge */}
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: '#f472b622', color: '#f472b6' }}
          >
            TEAM
          </span>
          <span className="text-xs" style={{ color: "#94a3b8" }}>
            {meta.memberCount ?? members.length} members
          </span>
        </div>

        {/* Member dots */}
        <div className="flex flex-wrap gap-1.5">
          {members.map((member, i) => (
            <div key={member} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
              />
              <span
                className="text-xs"
                style={{
                  color: member === meta.leadAgentId ? colors.text.primary : colors.text.secondary,
                  fontFamily: typography.fontFamily.mono,
                  fontWeight: member === meta.leadAgentId ? 600 : 400
                }}
              >
                {member}
                {member === meta.leadAgentId && (
                  <span style={{ color: '#f59e0b', marginLeft: 2 }}> *</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  )
}

export default ClaudeTeamCard
