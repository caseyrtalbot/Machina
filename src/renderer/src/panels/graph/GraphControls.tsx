import { useGraphStore } from '../../store/graph-store'
import { colors } from '../../design/tokens'

export function GraphControls() {
  const contentView = useGraphStore((s) => s.contentView)
  const setContentView = useGraphStore((s) => s.setContentView)

  if (contentView === 'editor') return null

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
      <div
        className="flex items-center gap-0.5 rounded-lg px-1 py-0.5"
        style={{ backgroundColor: colors.bg.surface, border: `1px solid ${colors.border.default}` }}
      >
        <button
          onClick={() => setContentView('graph')}
          className="px-3 py-1 text-sm rounded-md transition-colors"
          style={{
            backgroundColor: contentView === 'graph' ? colors.accent.muted : 'transparent',
            color: contentView === 'graph' ? colors.text.primary : colors.text.muted
          }}
        >
          Graph
        </button>
        <button
          onClick={() => setContentView('skills')}
          className="px-3 py-1 text-sm rounded-md transition-colors"
          style={{
            backgroundColor: contentView === 'skills' ? colors.accent.muted : 'transparent',
            color: contentView === 'skills' ? colors.text.primary : colors.text.muted
          }}
        >
          Skills
        </button>
      </div>
    </div>
  )
}
