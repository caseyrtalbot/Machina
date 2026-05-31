import { canvasTokens } from '../../../design/tokens'
import { typography, borderRadius } from '../../../design/tokens'

interface CardBadgeProps {
  readonly label: string
  readonly color?: string
}

export function CardBadge({ label, color = canvasTokens.badgeGreen }: CardBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        backgroundColor: color,
        color: 'var(--color-accent-fg)',
        fontSize: 10,
        fontFamily: typography.fontFamily.mono,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: typography.metadata.letterSpacing,
        padding: '4px 8px',
        borderRadius: borderRadius.inline,
        lineHeight: 1,
        userSelect: 'none'
      }}
    >
      {label}
    </span>
  )
}
