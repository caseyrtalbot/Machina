import { useMemo } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useCanvasStore } from '../../store/canvas-store'
import { colors } from '../../design/tokens'
import type { AgentActionName } from '@shared/agent-action-types'
import type { AgentPhase } from '../../hooks/use-agent-orchestrator'

interface CanvasActionBarProps {
  readonly onTriggerAction: (action: AgentActionName) => void
  readonly onStop: () => void
  readonly activeAction: AgentActionName | null
  readonly phase: AgentPhase
  readonly librarianActive: boolean
}

const actionLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.06em',
  color: colors.text.muted,
  cursor: 'pointer',
  padding: '4px 0',
  transition: 'color 150ms ease-out',
  background: 'none',
  border: 'none',
  outline: 'none',
  position: 'relative' as const
}

export function CanvasActionBar({
  onTriggerAction,
  onStop,
  activeAction,
  phase,
  librarianActive
}: CanvasActionBarProps): React.ReactElement | null {
  const artifacts = useVaultStore((s) => s.artifacts)
  const graph = useVaultStore((s) => s.graph)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)

  const isComputing = phase === 'computing'

  const unprocessedSourceCount = useMemo(() => {
    if (!graph) return 0

    const sourceArtifactIds = new Set<string>()
    for (const artifact of artifacts) {
      if (artifact.origin === 'source') sourceArtifactIds.add(artifact.id)
    }

    const compiledSourceIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.kind === 'derived_from' && sourceArtifactIds.has(edge.target)) {
        compiledSourceIds.add(edge.target)
      }
    }

    return sourceArtifactIds.size - compiledSourceIds.size
  }, [artifacts, graph])

  const hasAnyContent = artifacts.length > 0
  const hasSelection = selectedNodeIds.size > 0
  const showCompile = unprocessedSourceCount > 0 || hasSelection

  if (!hasAnyContent && !showCompile) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: '1.25rem'
      }}
    >
      {showCompile && (
        <ActionButton
          label="Compile"
          action="compile"
          isRunning={isComputing && activeAction === 'compile'}
          isBusy={isComputing && activeAction !== 'compile'}
          badge={unprocessedSourceCount > 0 ? unprocessedSourceCount : undefined}
          onTrigger={onTriggerAction}
          onStop={onStop}
        />
      )}

      {hasAnyContent && (
        <ActionButton
          label="Think"
          action="challenge"
          isRunning={isComputing && activeAction === 'challenge'}
          isBusy={isComputing && activeAction !== 'challenge'}
          onTrigger={onTriggerAction}
          onStop={onStop}
        />
      )}

      {hasAnyContent && (
        <ActionButton
          label="Librarian"
          action="librarian"
          isRunning={librarianActive}
          isBusy={isComputing}
          onTrigger={onTriggerAction}
          onStop={onStop}
        />
      )}
    </div>
  )
}

function ActionButton({
  label,
  action,
  isRunning,
  isBusy,
  badge,
  onTrigger,
  onStop
}: {
  readonly label: string
  readonly action: AgentActionName
  readonly isRunning: boolean
  readonly isBusy: boolean
  readonly badge?: number
  readonly onTrigger: (action: AgentActionName) => void
  readonly onStop: () => void
}): React.ReactElement {
  const displayLabel = isRunning ? 'Stop' : label

  return (
    <button
      type="button"
      style={{
        ...actionLabelStyle,
        ...(isRunning ? { color: '#f87171' } : {}),
        ...(isBusy ? { opacity: 0.4, cursor: 'default' } : {})
      }}
      onClick={() => {
        if (isRunning) {
          onStop()
        } else if (!isBusy) {
          onTrigger(action)
        }
      }}
      onMouseEnter={(e) => {
        if (isRunning) {
          e.currentTarget.style.color = '#fca5a5'
        } else if (!isBusy) {
          e.currentTarget.style.color = colors.text.primary
        }
      }}
      onMouseLeave={(e) => {
        if (isRunning) {
          e.currentTarget.style.color = '#f87171'
        } else if (!isBusy) {
          e.currentTarget.style.color = colors.text.muted
        }
      }}
    >
      {displayLabel}
      {badge !== undefined && !isRunning && (
        <span
          style={{
            color: 'var(--color-accent-default)',
            marginLeft: '0.35rem',
            fontSize: '10px'
          }}
        >
          {badge}
        </span>
      )}
      {isRunning && (
        <span
          style={{
            display: 'inline-block',
            width: '100%',
            height: '1px',
            background: '#f87171',
            position: 'absolute' as const,
            bottom: 0,
            left: 0,
            animation: 'te-pulse 2s ease-in-out infinite'
          }}
        />
      )}
    </button>
  )
}
