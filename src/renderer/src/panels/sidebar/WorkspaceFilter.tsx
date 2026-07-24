interface WorkspaceFilterProps {
  workspaces: string[]
  active: string | null
  onSelect: (workspace: string | null) => void
}

// Console: workspace chips are minimal hairline pills. Active uses
// accent-soft fill + accent line; idle uses transparent + subtle border so the
// row reads as a single rule of chips, not a stack of buttons.
export function WorkspaceFilter({ workspaces, active, onSelect }: WorkspaceFilterProps) {
  return (
    <div className="workspace-filter">
      <button
        onClick={() => onSelect(null)}
        className="workspace-chip te-wsfilter-chip"
        data-active={active === null ? 'true' : 'false'}
      >
        All
      </button>
      {workspaces.map((ws) => (
        <button
          key={ws}
          onClick={() => onSelect(ws)}
          className="workspace-chip te-wsfilter-chip"
          data-active={active === ws ? 'true' : 'false'}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
