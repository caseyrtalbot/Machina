interface BadgeProps {
  label: string
  color: string
  onClick?: () => void
}

export function Badge({ label, color, onClick }: BadgeProps) {
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-opacity hover:opacity-80"
      style={{ backgroundColor: color + '20', color }}
    >
      {label}
    </span>
  )
}
