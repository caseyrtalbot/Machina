interface SavedToBadgeProps {
  readonly relativePath: string
  readonly onOpen: () => void
}

export function SavedToBadge({ relativePath, onOpen }: SavedToBadgeProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className="te-saved-badge"
      title={`Open ${relativePath}`}
    >
      Saved → {relativePath}
    </button>
  )
}
