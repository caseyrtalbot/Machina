import { useMemo } from 'react'
import { useTabStore, TAB_DEFINITIONS } from '../store/tab-store'
import type { TabType } from '../store/tab-store'
import { useVaultStore } from '../store/vault-store'
import { useUiStore } from '../store/ui-store'
import { buildGhostIndex } from '../engine/ghost-index'
import { colors } from '../design/tokens'
import { useEnv } from '../design/Theme'
import { Atom } from '@phosphor-icons/react'

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

const GhostsIcon = <Atom size={ICON_SIZE} weight="regular" />

interface ActivityItem {
  view: TabType
  label: string
  icon: React.ReactNode
}

const ITEMS: ActivityItem[] = [
  { view: 'editor', label: 'Editor', icon: EditorIcon },
  { view: 'canvas', label: 'Canvas', icon: CanvasIcon },
  { view: 'graph', label: 'Graph', icon: GraphIcon },
  { view: 'ghosts', label: 'Ghosts', icon: GhostsIcon }
]

function useGhostCount(): number {
  const graph = useVaultStore((s) => s.graph)
  const artifacts = useVaultStore((s) => s.artifacts)
  const dismissed = useUiStore((s) => s.dismissedGhosts)
  const ghosts = useMemo(() => buildGhostIndex(graph, artifacts), [graph, artifacts])
  return useMemo(() => ghosts.filter((g) => !dismissed.includes(g.id)).length, [ghosts, dismissed])
}

export function ActivityBar() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)
  const ghostCount = useGhostCount()
  const { activityBarOpacity } = useEnv()

  return (
    <div
      className="flex flex-col items-center shrink-0 pt-12 gap-1"
      style={{
        width: 48,
        backgroundColor: `rgba(0, 0, 0, ${activityBarOpacity / 100})`,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRight: `1px solid ${colors.border.default}`
      }}
    >
      {ITEMS.map(({ view, label, icon }) => {
        const isActive = activeTabId === view
        const def = TAB_DEFINITIONS[view]
        const isGhostTab = view === 'ghosts'
        const ghostTint = isGhostTab
          ? ghostCount > 0
            ? '#f59e0b' // amber: unresolved ghosts
            : '#4ade80' // green: all resolved
          : undefined
        return (
          <button
            key={view}
            onClick={() =>
              openTab({ id: view, type: view, label: def.label, closeable: view !== 'editor' })
            }
            className="activity-btn relative flex items-center justify-center cursor-pointer"
            data-active={isActive || undefined}
            style={
              {
                width: 34,
                height: 34,
                '--base-opacity': isActive ? 0.9 : isGhostTab && ghostTint ? 0.7 : 0.4,
                '--base-bg': isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                color: ghostTint ?? colors.text.primary,
                borderRadius: 8,
                transition:
                  'opacity 150ms ease-out, background-color 150ms ease-out, color 300ms ease-out'
              } as React.CSSProperties
            }
            title={isGhostTab ? `${label} (${ghostCount})` : label}
            aria-label={`Switch to ${label} view`}
          >
            {icon}
          </button>
        )
      })}
    </div>
  )
}
