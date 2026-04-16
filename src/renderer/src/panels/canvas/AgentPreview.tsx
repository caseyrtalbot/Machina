/**
 * Preview bar shown at the top of the canvas during agent action preview.
 * Displays action name, op summary, and Apply / Cancel buttons.
 * Follows the OntologyPreview.tsx pattern.
 */

import { useEffect } from 'react'
import { colors, typography } from '../../design/tokens'
import type { AgentPhase } from '../../hooks/use-agent-orchestrator'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { AgentErrorTag } from '@shared/agent-action-types'
import { agentErrorCopy } from './agent-error-copy'

interface AgentPreviewProps {
  readonly phase: AgentPhase
  readonly actionName: string | null
  readonly plan: CanvasMutationPlan | null
  readonly errorMessage: string | null
  readonly errorTag: AgentErrorTag | null
  readonly onApply: () => void
  readonly onCancel: () => void
}

const barBase: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  borderRadius: 8,
  fontFamily: typography.fontFamily.mono,
  fontSize: 13,
  color: colors.text.primary
}

const btnBase: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13
}

function summarizeOps(plan: CanvasMutationPlan): string {
  const parts: string[] = []
  const { addedNodes, addedEdges, movedNodes } = plan.summary
  if (addedNodes > 0) parts.push(`${addedNodes} new card${addedNodes > 1 ? 's' : ''}`)
  if (addedEdges > 0) parts.push(`${addedEdges} edge${addedEdges > 1 ? 's' : ''}`)
  if (movedNodes > 0) parts.push(`${movedNodes} moved`)

  const removedNodes = plan.ops.filter((op) => op.type === 'remove-node').length
  const removedEdges = plan.ops.filter((op) => op.type === 'remove-edge').length
  if (removedNodes > 0) parts.push(`${removedNodes} removed`)
  if (removedEdges > 0) parts.push(`${removedEdges} edge${removedEdges > 1 ? 's' : ''} removed`)

  return parts.join(', ') || 'no changes'
}

export function AgentPreview({
  phase,
  actionName,
  plan,
  errorMessage,
  errorTag,
  onApply,
  onCancel
}: AgentPreviewProps) {
  // Keyboard: Enter to apply, Escape to cancel (any active phase)
  useEffect(() => {
    if (phase === 'idle') return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && phase === 'preview') {
        e.preventDefault()
        onApply()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, onApply, onCancel])

  // phase === 'computing' is now rendered by AgentThoughtCard, not here
  if (phase === 'computing') return null

  if (phase === 'error') {
    return (
      <div
        style={{
          ...barBase,
          backgroundColor: 'rgba(239,83,80,0.15)',
          border: '1px solid rgba(239,83,80,0.3)'
        }}
      >
        <span>
          {errorMessage
            ? agentErrorCopy({ error: errorMessage, tag: errorTag ?? undefined })
            : 'Agent action failed'}
        </span>
        <button
          onClick={onCancel}
          style={{
            opacity: 0.7,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: 'inherit'
          }}
        >
          Dismiss
        </button>
      </div>
    )
  }

  if (phase === 'preview' && plan) {
    return (
      <div
        style={{
          ...barBase,
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(12px)'
        }}
      >
        <span style={{ opacity: 0.8 }}>{actionName}</span>
        <span style={{ opacity: 0.5 }}>{summarizeOps(plan)}</span>
        <button
          onClick={onApply}
          style={{
            ...btnBase,
            backgroundColor: 'rgba(76,175,80,0.2)',
            border: '1px solid rgba(76,175,80,0.4)',
            color: '#66bb6a'
          }}
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          style={{
            ...btnBase,
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: colors.text.secondary
          }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return null
}
