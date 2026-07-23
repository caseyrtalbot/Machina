import { useState } from 'react'
import { borderRadius, colors, floatingPanel, transitions, typography } from '../../design/tokens'

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

const eyebrowStyle: React.CSSProperties = {
  fontSize: typography.metadata.size,
  fontFamily: typography.fontFamily.mono,
  color: colors.text.muted,
  letterSpacing: typography.metadata.letterSpacing,
  textTransform: 'uppercase'
}

const hintStyle: React.CSSProperties = {
  fontSize: typography.metadata.size,
  fontFamily: typography.fontFamily.mono,
  color: colors.text.muted,
  letterSpacing: typography.metadata.letterSpacing
}

function ActionButton({ action }: { readonly action: EmptyStateAction }) {
  const [hovered, setHovered] = useState(false)
  const primary = action.kind !== 'secondary'
  return (
    <button
      type="button"
      onClick={action.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 500,
        fontFamily: typography.fontFamily.body,
        lineHeight: 1.5,
        borderRadius: borderRadius.tool,
        cursor: 'pointer',
        ...(primary
          ? {
              color: 'var(--color-accent-fg)',
              backgroundColor: hovered ? colors.accent.hover : colors.accent.default,
              border: 'none',
              transition: `background-color ${transitions.default}`
            }
          : {
              color: hovered ? colors.text.primary : colors.text.secondary,
              backgroundColor: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              transition: `color ${transitions.default}`
            })
      }}
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
      {icon && <div style={{ marginBottom: 4 }}>{icon}</div>}
      {eyebrow && <div style={{ ...eyebrowStyle, marginBottom: 12 }}>{eyebrow}</div>}
      {title && (
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            fontFamily: typography.fontFamily.display,
            color: colors.text.primary,
            lineHeight: 1.4,
            marginBottom: body ? 8 : 0
          }}
        >
          {title}
        </h2>
      )}
      {body && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
            lineHeight: 1.6,
            marginBottom: actions && actions.length > 0 ? 20 : 0
          }}
        >
          {body}
        </p>
      )}
      {actions && actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {actions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </div>
      )}
      {hint && <div style={{ ...hintStyle, marginTop: 16 }}>{hint}</div>}
    </>
  )

  if (variant === 'card') {
    const card = (
      <div
        className={overlay ? 'pointer-events-auto' : undefined}
        style={{
          width: 360,
          padding: 28,
          borderRadius: borderRadius.card,
          backgroundColor: 'var(--canvas-card-bg)',
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          border: '1px solid var(--canvas-card-border)',
          boxShadow: floatingPanel.shadow
        }}
      >
        {content}
      </div>
    )
    return (
      <div
        data-testid={testId}
        className={
          overlay
            ? 'absolute inset-0 flex items-center justify-center z-[1] pointer-events-none'
            : 'h-full flex items-center justify-center'
        }
        style={overlay ? { marginTop: -40 } : undefined}
      >
        {card}
      </div>
    )
  }

  const start = align === 'start'
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: start ? 'flex-start' : 'center',
        justifyContent: start ? 'flex-start' : 'center',
        ...(height === 'fill' ? { height: '100%' } : {}),
        padding: start ? '18% 32px 0' : height === 'content' ? '4rem 2rem' : 24,
        boxSizing: 'border-box'
      }}
    >
      <div
        style={
          start
            ? { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }
            : { textAlign: 'center', maxWidth }
        }
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
