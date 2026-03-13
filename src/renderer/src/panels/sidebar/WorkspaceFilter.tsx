import { colors } from '../../design/tokens'

interface WorkspaceFilterProps {
  workspaces: string[]
  active: string | null
  onSelect: (workspace: string | null) => void
}

export function WorkspaceFilter({ workspaces, active, onSelect }: WorkspaceFilterProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-xs overflow-x-auto">
      <button
        onClick={() => onSelect(null)}
        className="px-2 py-0.5 rounded whitespace-nowrap transition-colors"
        style={{
          backgroundColor: active === null ? colors.accent.muted : 'transparent',
          color: active === null ? colors.accent.default : colors.text.secondary
        }}
      >
        All
      </button>
      {workspaces.map((ws) => (
        <button
          key={ws}
          onClick={() => onSelect(ws)}
          className="px-2 py-0.5 rounded whitespace-nowrap transition-colors"
          style={{
            backgroundColor: active === ws ? colors.accent.muted : 'transparent',
            color: active === ws ? colors.accent.default : colors.text.secondary
          }}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
