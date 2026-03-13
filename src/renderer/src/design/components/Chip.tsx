import { colors } from '../tokens'

interface ChipProps {
  icon: string
  label: string
  onClick?: () => void
}

export function Chip({ icon, label, onClick }: ChipProps) {
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors"
      style={
        {
          color: colors.text.secondary,
          '--color-bg-elevated': colors.bg.elevated
        } as React.CSSProperties
      }
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}
