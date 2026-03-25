import { useState, useCallback } from 'react'
import { useTabStore, TAB_DEFINITIONS } from '../store/tab-store'
import type { ViewTab, TabType } from '../store/tab-store'
import { useCanvasStore } from '../store/canvas-store'
import { colors, transitions } from '../design/tokens'

interface ViewTabBarProps {
  readonly onOpenSettings?: () => void
}

const TAB_ICONS: Record<string, React.ReactNode> = {
  editor: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
  canvas: (
    <>
      <rect x="3" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="16" width="7" height="5" rx="1" />
      <path d="M10 5.5h4a2 2 0 0 1 2 2v4" />
      <path d="M14 18.5h-4a2 2 0 0 1-2-2v-4" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <line x1="8" y1="7" x2="16" y2="7.5" />
      <line x1="7" y1="8" x2="11" y2="16.5" />
      <line x1="16" y1="10" x2="13" y2="16" />
    </>
  ),
  workbench: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </>
  )
}

function TabIcon({ iconId }: { readonly iconId: string }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TAB_ICONS[iconId]}
    </svg>
  )
}

function AddTabButton() {
  const [open, setOpen] = useState(false)
  const tabs = useTabStore((s) => s.tabs)
  const openTab = useTabStore((s) => s.openTab)

  const handleOpen = useCallback(
    (type: TabType, label: string) => {
      openTab({ id: type, type, label, closeable: type !== 'editor' })
      setOpen(false)
    },
    [openTab]
  )

  const openTypes = new Set(tabs.map((t) => t.type))
  const available = (
    Object.entries(TAB_DEFINITIONS) as [TabType, { label: string; iconId: string }][]
  ).filter(([type]) => !openTypes.has(type))

  if (available.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center justify-center shrink-0 cursor-pointer"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          color: colors.text.muted,
          fontSize: 16,
          transition: transitions.default
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = colors.text.primary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = colors.text.muted
        }}
        title="Open a new tab"
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 rounded-lg py-1"
            style={{
              backgroundColor: colors.bg.elevated,
              border: `1px solid ${colors.border.default}`,
              minWidth: 160,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
          >
            {available.map(([type, def]) => (
              <button
                key={type}
                onClick={() => handleOpen(type, def.label)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left cursor-pointer"
                style={{
                  fontSize: 12,
                  color: colors.text.secondary,
                  transition: transitions.default
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.color = colors.text.primary
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = colors.text.secondary
                }}
              >
                <TabIcon iconId={def.iconId} />
                {def.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function ViewTabBar({ onOpenSettings }: ViewTabBarProps) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)
  const closeTab = useTabStore((s) => s.closeTab)

  const safeCloseTab = useCallback(
    (tabId: string, tabType: string) => {
      if (tabType === 'canvas' || tabType === 'workbench') {
        const hasTerminals = useCanvasStore.getState().nodes.some((n) => n.type === 'terminal')
        if (hasTerminals) {
          const confirmed = window.confirm('Active terminal sessions will be closed. Continue?')
          if (!confirmed) return
        }
      }
      closeTab(tabId)
    },
    [closeTab]
  )

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, tab: ViewTab) => {
      if (e.button === 1 && tab.closeable) {
        e.preventDefault()
        safeCloseTab(tab.id, tab.type)
      }
    },
    [safeCloseTab]
  )

  return (
    <div
      className="flex items-end shrink-0 overflow-x-auto"
      style={{
        height: 36,
        padding: '0 8px',
        borderBottom: `1px solid ${colors.border.subtle}`
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const def = TAB_DEFINITIONS[tab.type]
        return (
          <div
            key={tab.id}
            className="flex items-center group shrink-0 cursor-pointer relative"
            style={
              {
                padding: '0 16px',
                height: isActive ? 30 : 28,
                marginBottom: isActive ? -1 : 1,
                fontSize: 12,
                borderRadius: '6px 6px 0 0',
                backgroundColor: isActive ? 'var(--color-bg-surface)' : 'transparent',
                borderTop: isActive
                  ? '1px solid rgba(255, 255, 255, 0.08)'
                  : '1px solid transparent',
                borderLeft: isActive
                  ? '1px solid rgba(255, 255, 255, 0.08)'
                  : '1px solid transparent',
                borderRight: isActive
                  ? '1px solid rgba(255, 255, 255, 0.08)'
                  : '1px solid transparent',
                borderBottom: isActive
                  ? '1px solid var(--color-bg-surface)'
                  : '1px solid transparent',
                color: isActive ? colors.text.primary : colors.text.secondary,
                transition: transitions.default
              } as React.CSSProperties
            }
            onClick={() => activateTab(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab)}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <TabIcon iconId={def?.iconId ?? tab.type} />
            <span className="truncate select-none ml-1.5" style={{ maxWidth: 120 }}>
              {tab.label}
            </span>
            {tab.closeable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  safeCloseTab(tab.id, tab.type)
                }}
                className="flex items-center justify-center w-4 h-4 ml-1.5 rounded cursor-pointer opacity-0 group-hover:opacity-100"
                style={{
                  color: colors.text.muted,
                  fontSize: 11,
                  transition: transitions.default
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <AddTabButton />
      {/* Spacer — fills remaining titlebar drag area */}
      <div className="flex-1" />
      {/* Settings gear (migrated from Titlebar) */}
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded shrink-0 cursor-pointer"
          style={
            {
              color: colors.text.secondary,
              opacity: 0.6,
              transition: transitions.default
            } as React.CSSProperties
          }
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6'
          }}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
          </svg>
        </button>
      )}
    </div>
  )
}
