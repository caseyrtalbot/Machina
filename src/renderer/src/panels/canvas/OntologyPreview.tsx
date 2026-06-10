/**
 * Preview bar shown at the top of the canvas during ontology operations.
 * Displays group/card counts and provides Apply / Cancel actions.
 */

import { borderRadius, colors, floatingPanel, typography } from '../../design/tokens'

interface OntologyPreviewProps {
  readonly phase: 'preview' | 'error'
  readonly errorMessage?: string
  readonly groupCount: number
  readonly cardCount: number
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
  borderRadius: borderRadius.tool,
  fontFamily: typography.fontFamily.mono,
  fontSize: 13,
  color: colors.text.primary
}

const btnBase: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: borderRadius.tool,
  cursor: 'pointer',
  fontSize: 13
}

export function OntologyPreview({
  phase,
  errorMessage,
  groupCount,
  cardCount,
  onApply,
  onCancel
}: OntologyPreviewProps) {
  if (phase === 'error') {
    return (
      <div
        style={{
          ...barBase,
          backgroundColor: 'color-mix(in srgb, var(--signal-danger) 15%, transparent)',
          border: '1px solid color-mix(in srgb, var(--signal-danger) 30%, transparent)'
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
        backgroundColor: floatingPanel.glass.popoverBg,
        border: '1px solid var(--line-default)',
        backdropFilter: floatingPanel.glass.popoverBlur
      }}
    >
      <span style={{ opacity: 0.6 }}>
        {groupCount} sections &middot; {cardCount} cards
      </span>
      <button
        onClick={onApply}
        style={{
          ...btnBase,
          backgroundColor: 'color-mix(in srgb, var(--signal-success) 20%, transparent)',
          border: '1px solid color-mix(in srgb, var(--signal-success) 40%, transparent)',
          color: 'var(--signal-success)'
        }}
      >
        Apply
      </button>
      <button
        onClick={onCancel}
        style={{
          ...btnBase,
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid var(--line-default)',
          color: colors.text.secondary
        }}
      >
        Cancel
      </button>
    </div>
  )
}
