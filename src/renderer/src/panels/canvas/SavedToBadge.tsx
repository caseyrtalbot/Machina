import { colors } from '../../design/tokens'

export interface SavedToBadgeProps {
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
      className="px-2 py-0.5 text-[10px] truncate"
      title={`Open ${relativePath}`}
      style={{
        backgroundColor: colors.accent.muted,
        color: colors.text.secondary,
        borderRadius: 4,
        maxWidth: '100%',
        cursor: 'pointer'
      }}
    >
      Saved → {relativePath}
    </button>
  )
}

export default SavedToBadge
