interface EmptyStateAction {
  readonly label: string
  readonly onClick: () => void
  /** Default 'primary' (accent fill); 'secondary' is the outline style. */
  readonly kind?: 'primary' | 'secondary'
}

export interface EmptyStateProps {
  /** 'card' = glass card (canvas/graph); 'plain' = unchromed centered block. */
  readonly variant?: 'card' | 'plain'
  /** card only: render as an absolute pointer-events-none overlay over live content. */
  readonly overlay?: boolean
  /** plain only: 'start' is the top/left-aligned layout (thread panel). */
  readonly align?: 'center' | 'start'
  /** plain only: 'content' sits in flow with block padding instead of filling. */
  readonly height?: 'fill' | 'content'
  readonly icon?: React.ReactNode
  readonly eyebrow?: string
  readonly title?: string
  readonly body?: React.ReactNode
  readonly actions?: readonly EmptyStateAction[]
  readonly hint?: React.ReactNode
  /** plain/center only: text block width cap. */
  readonly maxWidth?: number
  readonly testId?: string
}

function ActionButton({ action }: { readonly action: EmptyStateAction }) {
  const primary = action.kind !== 'secondary'
  return (
    <button
      type="button"
      className="te-empty-action"
      data-kind={primary ? 'primary' : 'secondary'}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  )
}

/**
 * The one empty-state pattern: eyebrow → title → body → actions → hint, with
 * an optional icon. Consumers own content and behavior; chrome lives here.
 */
export function EmptyState({
  variant = 'plain',
  overlay = false,
  align = 'center',
  height = 'fill',
  icon,
  eyebrow,
  title,
  body,
  actions,
  hint,
  maxWidth = 320,
  testId
}: EmptyStateProps) {
  const content = (
    <>
      {icon && <div className="te-empty__icon">{icon}</div>}
      {eyebrow && <div className="te-empty__eyebrow">{eyebrow}</div>}
      {title && (
        <h2 className="te-empty__title" data-has-body={Boolean(body) || undefined}>
          {title}
        </h2>
      )}
      {body && (
        <p
          className="te-empty__text"
          data-has-actions={(actions && actions.length > 0) || undefined}
        >
          {body}
        </p>
      )}
      {actions && actions.length > 0 && (
        <div className="te-empty__actions">
          {actions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </div>
      )}
      {hint && <div className="te-empty__hint">{hint}</div>}
    </>
  )

  if (variant === 'card') {
    return (
      <div
        data-testid={testId}
        className="te-empty"
        data-variant="card"
        data-overlay={overlay || undefined}
      >
        <div className="te-empty__card">{content}</div>
      </div>
    )
  }

  return (
    <div
      data-testid={testId}
      className="te-empty"
      data-variant="plain"
      data-align={align}
      data-height={height}
    >
      <div
        className="te-empty__inner"
        data-align={align}
        style={align === 'center' ? { maxWidth } : undefined}
      >
        {content}
      </div>
    </div>
  )
}

/** Shared check-circle glyph (ghosts all-resolved, health green state). */
export function CheckCircleIcon({
  size = 32,
  stroke = 'currentColor',
  opacity = 0.5
}: {
  readonly size?: number
  readonly stroke?: string
  readonly opacity?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity }}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
