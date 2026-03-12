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
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer hover:bg-[#1A1A1D] transition-colors"
      style={{ color: colors.text.secondary }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}
