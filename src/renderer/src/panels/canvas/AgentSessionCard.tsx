import { useMemo, useState, memo } from 'react'
import { CardShell } from './CardShell'
import { useCanvasStore } from '../../store/canvas-store'
import { colors, typography } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import type { AgentSessionStatus } from '@shared/agent-types'
import { formatElapsed } from '@shared/format-elapsed'

interface AgentSessionCardProps {
  readonly node: CanvasNode
}

const STATUS_COLORS: Record<AgentSessionStatus, string> = {
  active: '#22c55e',
  idle: '#eab308',
  completed: '#6b7280'
}

const monoMuted = {
  fontSize: 10,
  fontFamily: typography.fontFamily.mono,
  color: colors.text.muted
} as const

export function AgentSessionCard({ node }: AgentSessionCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const sessionId = (node.metadata?.sessionId as string) ?? 'Unknown Session'
  const label = node.metadata?.label as string | undefined
  const status = ((node.metadata?.status as string) ?? 'idle') as AgentSessionStatus
  const filesTouched = (node.metadata?.filesTouched as readonly string[]) ?? []
  const [now] = useState(() => Date.now())
  const startedAt = (node.metadata?.startedAt as number) ?? now
  const lastActivity = (node.metadata?.lastActivity as number) ?? now
  const currentCommand = node.metadata?.currentCommand as string | undefined
  const cwd = node.metadata?.cwd as string | undefined
  const currentTask = node.metadata?.currentTask as string | undefined
  const agentType = node.metadata?.agentType as string | undefined

  const elapsed = useMemo(() => formatElapsed(now - startedAt), [now, startedAt])
  const lastActivityStr = useMemo(() => new Date(lastActivity).toLocaleTimeString(), [lastActivity])

  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle
  const title = label ?? sessionId

  return (
    <CardShell node={node} title={title} onClose={() => removeNode(node.id)}>
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 0 }}>
        {/* Status + elapsed row */}
        <div className="flex items-center justify-between">
          <div data-testid="agent-status" className="flex items-center gap-1.5">
            <span
              className="inline-block rounded-full"
              style={{
                width: 6,
                height: 6,
                backgroundColor: statusColor,
                boxShadow: status === 'active' ? `0 0 6px ${statusColor}` : 'none'
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.secondary,
                textTransform: 'uppercase',
                letterSpacing: '0.06em'
              }}
            >
              {status}
            </span>
          </div>
          <span
            data-testid="agent-elapsed"
            style={{
              fontSize: 11,
              fontFamily: typography.fontFamily.mono,
              color: colors.text.muted
            }}
          >
            {elapsed}
          </span>
        </div>

        {/* Agent type badge */}
        {agentType && (
          <div
            data-testid="agent-type"
            style={{
              ...monoMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.08em'
            }}
          >
            {agentType}
          </div>
        )}

        {/* Current command */}
        {currentCommand && (
          <div data-testid="agent-command" style={monoMuted}>
            <span style={{ opacity: 0.6 }}>cmd:</span> {currentCommand}
          </div>
        )}

        {/* Working directory */}
        {cwd && (
          <div
            data-testid="agent-cwd"
            style={{
              ...monoMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title={cwd}
          >
            <span style={{ opacity: 0.6 }}>cwd:</span> {cwd.split('/').pop() || cwd}
          </div>
        )}

        {/* Current task */}
        {currentTask && (
          <div
            data-testid="agent-task"
            style={{
              fontSize: 11,
              fontFamily: typography.fontFamily.mono,
              color: colors.text.secondary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title={currentTask}
          >
            {currentTask}
          </div>
        )}

        {/* Last activity */}
        <div data-testid="agent-last-activity" style={monoMuted}>
          last: {lastActivityStr}
        </div>

        {/* Files touched */}
        <div data-testid="agent-files">
          <div
            style={{
              ...monoMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4
            }}
          >
            {filesTouched.length} files touched
          </div>
          <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 120 }}>
            {filesTouched.map((f) => (
              <div
                key={f}
                style={{
                  fontSize: 11,
                  fontFamily: typography.fontFamily.mono,
                  color: colors.text.secondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={f}
              >
                {f.split('/').pop()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  )
}

export default memo(AgentSessionCard)
