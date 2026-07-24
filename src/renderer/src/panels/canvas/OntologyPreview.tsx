/**
 * Preview bar shown at the top of the canvas during ontology operations.
 * Displays group/card counts and provides Apply / Cancel actions.
 */

interface OntologyPreviewProps {
  readonly phase: 'preview' | 'error'
  readonly errorMessage?: string
  readonly groupCount: number
  readonly cardCount: number
  readonly onApply: () => void
  readonly onCancel: () => void
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
      <div className="te-ontology-bar te-ontology-bar--error">
        <span>{errorMessage ?? 'Failed to organize'}</span>
        <button onClick={onCancel} className="te-ontology-dismiss">
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="te-ontology-bar te-ontology-bar--preview">
      <span className="te-ontology-count">
        {groupCount} sections &middot; {cardCount} cards
      </span>
      <button onClick={onApply} className="te-ontology-btn te-ontology-btn--apply">
        Apply
      </button>
      <button onClick={onCancel} className="te-ontology-btn te-ontology-btn--cancel">
        Cancel
      </button>
    </div>
  )
}
