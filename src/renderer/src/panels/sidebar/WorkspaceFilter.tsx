import { borderRadius, colors, typography } from '../../design/tokens'

interface WorkspaceFilterProps {
  workspaces: string[]
  active: string | null
  onSelect: (workspace: string | null) => void
}

// Console: workspace chips are minimal hairline pills. Active uses
// accent-soft fill + accent line; idle uses transparent + subtle border so the
// row reads as a single rule of chips, not a stack of buttons.
function chipStyle(active: boolean): React.CSSProperties {
  return {
    backgroundColor: active ? colors.accent.soft : 'transparent',
    color: active ? colors.accent.default : colors.text.muted,
    border: `0.5px solid ${active ? colors.accent.line : colors.border.subtle}`,
    borderRadius: borderRadius.inline,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.metadata.size,
    letterSpacing: typography.metadata.letterSpacing,
    textTransform: typography.metadata.textTransform,
    padding: '4px 8px',
    lineHeight: 1
  }
}

export function WorkspaceFilter({ workspaces, active, onSelect }: WorkspaceFilterProps) {
  return (
    <div className="workspace-filter text-xs">
      <button
        onClick={() => onSelect(null)}
        className="workspace-chip"
        style={chipStyle(active === null)}
      >
        All
      </button>
      {workspaces.map((ws) => (
        <button
          key={ws}
          onClick={() => onSelect(ws)}
          className="workspace-chip"
          style={chipStyle(active === ws)}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
