import { useGraphStore } from '../store/graph-store'
import { colors } from '../design/tokens'

type ContentView = 'editor' | 'graph' | 'skills' | 'canvas'

interface ActivityItem {
  view: ContentView
  label: string
  icon: React.ReactNode
}

const ICON_SIZE = 20

const EditorIcon = (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="12" y2="17" />
  </svg>
)

const GraphIcon = (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <circle cx="8" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <line x1="8.2" y1="7.2" x2="15.8" y2="7.2" />
    <line x1="7.5" y1="8.2" x2="7.5" y2="15.8" />
    <line x1="10.2" y1="17" x2="15.8" y2="17.5" />
  </svg>
)

const SkillsIcon = (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

const CanvasIcon = (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="16" width="7" height="5" rx="1" />
    <path d="M10 5.5h4a2 2 0 0 1 2 2v4" />
    <path d="M14 18.5h-4a2 2 0 0 1-2-2v-4" />
  </svg>
)

const ITEMS: ActivityItem[] = [
  { view: 'editor', label: 'Editor', icon: EditorIcon },
  { view: 'graph', label: 'Graph', icon: GraphIcon },
  { view: 'canvas', label: 'Canvas', icon: CanvasIcon },
  { view: 'skills', label: 'Skills', icon: SkillsIcon }
]

export function ActivityBar() {
  const contentView = useGraphStore((s) => s.contentView)
  const setContentView = useGraphStore((s) => s.setContentView)

  return (
    <div
      className="flex flex-col items-center shrink-0 py-3 gap-1"
      style={{ width: 48, backgroundColor: colors.bg.base }}
    >
      {ITEMS.map(({ view, label, icon }) => {
        const isActive = contentView === view
        return (
          <button
            key={view}
            onClick={() => setContentView(view)}
            className="relative flex items-center justify-center transition-opacity"
            style={{
              width: 36,
              height: 36,
              opacity: isActive ? 1 : 0.5,
              color: colors.text.primary
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.opacity = '0.85'
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.opacity = '0.5'
            }}
            title={label}
            aria-label={`Switch to ${label} view`}
          >
            {isActive && (
              <span
                className="absolute left-0 rounded-r"
                style={{
                  width: 3,
                  height: 20,
                  backgroundColor: colors.accent.default
                }}
              />
            )}
            {icon}
          </button>
        )
      })}
    </div>
  )
}
