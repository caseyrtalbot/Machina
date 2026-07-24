import { canvasTokens } from '../../../design/tokens'

interface CardBadgeProps {
  readonly label: string
  readonly color?: string
}

export function CardBadge({ label, color = canvasTokens.badgeGreen }: CardBadgeProps) {
  return (
    <span className="te-card-badge" style={{ backgroundColor: color }}>
      {label}
    </span>
  )
}
