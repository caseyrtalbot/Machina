import { useGraphStore } from '../../store/graph-store'
import { colors } from '../../design/tokens'

type ContentView = 'editor' | 'graph' | 'skills'

const TABS: { view: ContentView; label: string }[] = [
  { view: 'editor', label: 'Editor' },
  { view: 'graph', label: 'Graph' },
  { view: 'skills', label: 'Skills' }
]

export function GraphControls() {
  const contentView = useGraphStore((s) => s.contentView)
  const setContentView = useGraphStore((s) => s.setContentView)

  return (
    <div className="absolute top-2 left-2 z-20">
      <div
        className="flex items-center gap-px rounded-md overflow-hidden"
        style={{
          backgroundColor: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`
        }}
      >
        {TABS.map(({ view, label }) => {
          const isActive = contentView === view
          return (
            <button
              key={view}
              onClick={() => setContentView(view)}
              className="px-2.5 py-1 text-xs transition-colors"
              style={{
                backgroundColor: isActive ? colors.accent.muted : 'transparent',
                color: isActive ? colors.accent.default : colors.text.muted
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
