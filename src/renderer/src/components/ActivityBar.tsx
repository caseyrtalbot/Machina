import { useTabStore, TAB_DEFINITIONS } from '../store/tab-store'
import type { TabType } from '../store/tab-store'
import { colors, floatingPanel } from '../design/tokens'

interface ActivityItem {
  view: TabType
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
    <circle cx="12" cy="18" r="2.5" />
    <circle cx="5" cy="15" r="1.5" />
    <line x1="8" y1="7" x2="16" y2="7.5" />
    <line x1="7" y1="8" x2="11" y2="16.5" />
    <line x1="16" y1="10" x2="13" y2="16" />
    <line x1="6" y1="13.5" x2="6" y2="8.5" />
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

const ITEMS: ActivityItem[] = [
  { view: 'editor', label: 'Editor', icon: EditorIcon },
  { view: 'canvas', label: 'Canvas', icon: CanvasIcon },
  { view: 'graph', label: 'Graph', icon: GraphIcon },
  { view: 'skills', label: 'Skills', icon: SkillsIcon }
]

export function ActivityBar({ floating }: { readonly floating?: boolean }) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)

  return (
    <div
      className={
        floating
          ? 'absolute flex flex-col items-center gap-0.5'
          : 'flex flex-col items-center shrink-0 pt-8 gap-0.5'
      }
      style={
        floating
          ? {
              top: 40,
              left: 12,
              width: 40,
              zIndex: 40,
              padding: '6px 0',
              borderRadius: floatingPanel.borderRadius,
              boxShadow: floatingPanel.shadowCompact,
              backdropFilter: floatingPanel.blur.compact,
              backgroundColor: colors.bg.elevated
            }
          : {
              width: 40,
              backgroundColor: colors.bg.base,
              borderRight: '1px solid rgba(255, 255, 255, 0.04)'
            }
      }
    >
      {ITEMS.map(({ view, label, icon }) => {
        const isActive = activeTabId === view
        const def = TAB_DEFINITIONS[view]
        return (
          <button
            key={view}
            onClick={() =>
              openTab({ id: view, type: view, label: def.label, closeable: view !== 'editor' })
            }
            className="relative flex items-center justify-center transition-opacity cursor-pointer"
            style={{
              width: 32,
              height: 32,
              opacity: isActive ? 1 : 0.4,
              color: colors.text.primary,
              borderRadius: 6
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.opacity = '0.8'
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.opacity = isActive ? '1' : '0.4'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            title={label}
            aria-label={`Switch to ${label} view`}
          >
            {isActive && (
              <span
                className="absolute left-0 rounded-r"
                style={{
                  width: 2,
                  height: 16,
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
