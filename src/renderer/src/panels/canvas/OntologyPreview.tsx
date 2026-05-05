/**
 * Preview bar shown at the top of the canvas during ontology operations.
 * Displays group/card counts and provides Apply / Cancel / Agent actions.
 */

import { colors, typography } from '../../design/tokens'

interface OntologyPreviewProps {
  readonly phase: 'preview' | 'error' | 'loading'
  readonly errorMessage?: string
  readonly groupCount: number
  readonly cardCount: number
  readonly onApply: () => void
  readonly onCancel: () => void
  readonly onRunAgent?: () => void
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

export function OntologyPreview({
  phase,
  errorMessage,
  groupCount,
  cardCount,
  onApply,
  onCancel,
  onRunAgent
}: OntologyPreviewProps) {
  if (phase === 'error') {
    return (
      <div
        style={{
          ...barBase,
          backgroundColor: 'rgba(239,83,80,0.15)',
          border: '1px solid rgba(239,83,80,0.3)'
        }}
      >
        <span>{errorMessage ?? 'Failed to organize'}</span>
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

  return (
    <div
      style={{
        ...barBase,
        backgroundColor: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)'
      }}
    >
      <span style={{ opacity: 0.6 }}>
        {groupCount} sections &middot; {cardCount} cards
      </span>
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
      {onRunAgent && (
        <button
          onClick={onRunAgent}
          style={{
            ...btnBase,
            backgroundColor: 'rgba(171,71,188,0.15)',
            border: '1px solid rgba(171,71,188,0.3)',
            color: '#ce93d8'
          }}
        >
          + Agent Analysis
        </button>
      )}
    </div>
  )
}
