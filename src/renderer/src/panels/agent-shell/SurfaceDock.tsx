import { useCallback, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DockTabBar } from './DockTabBar'
import { DockTabContent } from './DockTabContent'
import { colors, typography } from '../../design/tokens'
import { type DockTab } from '@shared/dock-types'
import { useCliAgentPresence, type CLIAgentPresence } from '../../hooks/use-cli-agent-presence'
import { CliAgentBadge } from '../../components/CliAgentBadge'

const EMPTY_TABS: readonly DockTab[] = []

// Module-scoped identity for DockTab objects. WeakMap lets entries be garbage
// collected when the tab object is dropped from the store, so this never grows.
// Lives outside the component so render-time access is not a ref read.
const tabIdMap = new WeakMap<DockTab, string>()
let tabIdCounter = 0
function tabIdentity(tab: DockTab): string {
  const cached = tabIdMap.get(tab)
  if (cached) return cached
  tabIdCounter += 1
  const id = `t${tabIdCounter}`
  tabIdMap.set(tab, id)
  return id
}

interface SurfaceDockProps {
  readonly width?: number
}

export function SurfaceDock({ width = 480 }: SurfaceDockProps = {}) {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useThreadStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const collapsed = useThreadStore((s) => s.dockCollapsed)
  const agentPresence = useCliAgentPresence()
  const storedActiveIndex = useThreadStore((s) => (id ? (s.dockActiveIndexByThreadId[id] ?? 0) : 0))
  const setStoreActive = useThreadStore((s) => s.setDockActiveIndex)
  // Track per-thread tab counts so a freshly-added tab (command palette,
  // ribbon, etc.) becomes active without a follow-up click. The user's last
  // active tab per thread lives in the store and survives thread switches.
  const [prevLengthByThread, setPrevLengthByThread] = useState<Record<string, number>>({})
  if (id) {
    const prevLen = prevLengthByThread[id]
    if (prevLen === undefined) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
    } else if (tabs.length > prevLen) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
      setStoreActive(id, tabs.length - 1)
    } else if (tabs.length !== prevLen) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
    }
  }
  const onActivate = useCallback(
    (i: number) => {
      if (id) setStoreActive(id, i)
    },
    [id, setStoreActive]
  )
  const safeIndex = storedActiveIndex < tabs.length ? storedActiveIndex : 0
  const active = tabs[safeIndex]
  // Track which tab ids have been activated so previously-loaded tabs stay
  // mounted across switches. Tabs not yet visited are skipped to avoid eager
  // loading of every kind. Trimmed to currently-open tabs to free state on close.
  // Synced during render — React's recommended pattern for state derived from
  // props, see https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  const [mountedIds, setMountedIds] = useState<readonly string[]>(() =>
    active ? [tabIdentity(active)] : []
  )
  const [syncSnapshot, setSyncSnapshot] = useState<{
    readonly tabs: readonly DockTab[]
    readonly active: DockTab | undefined
  }>({ tabs, active })
  if (syncSnapshot.tabs !== tabs || syncSnapshot.active !== active) {
    setSyncSnapshot({ tabs, active })
    const openIds = new Set(tabs.map(tabIdentity))
    const activeId = active ? tabIdentity(active) : null
    const next = mountedIds.filter((k) => openIds.has(k))
    if (activeId && !next.includes(activeId)) next.push(activeId)
    const changed = next.length !== mountedIds.length || !next.every((k, i) => k === mountedIds[i])
    if (changed) setMountedIds(next)
  }

  // Agent presence strip: terminal tabs whose sessions have a CLI agent
  // (claude/codex/gemini) detected by CLIAgentSessionListener (item 3.12).
  const terminalAgents: Array<{ tabIndex: number; sessionId: string; presence: CLIAgentPresence }> =
    []
  tabs.forEach((tab, tabIndex) => {
    if (tab.kind !== 'terminal' || !tab.sessionId) return
    const presence = agentPresence[tab.sessionId]
    if (presence) terminalAgents.push({ tabIndex, sessionId: tab.sessionId, presence })
  })

  if (collapsed) return <aside data-testid="dock-collapsed" style={{ width: 0 }} />
  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: colors.bg.rail,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <DockTabBar activeIndex={safeIndex} onActivate={onActivate} />
      {terminalAgents.length > 0 ? (
        <div
          data-testid="dock-agent-presence"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            padding: '3px 8px',
            overflowX: 'auto',
            borderBottom: `1px solid ${colors.tab.border}`
          }}
        >
          {terminalAgents.map(({ tabIndex, sessionId, presence }) => (
            <button
              key={sessionId}
              type="button"
              title={`Show terminal · ${sessionId.slice(0, 6)}`}
              onClick={() => onActivate(tabIndex)}
              style={{
                display: 'inline-flex',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer'
              }}
            >
              <CliAgentBadge presence={presence} />
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {active ? (
          tabs.map((tab) => {
            const key = tabIdentity(tab)
            if (!mountedIds.includes(key)) return null
            const isActive = tab === active
            return (
              <div
                key={key}
                style={{
                  display: isActive ? 'block' : 'none',
                  height: '100%'
                }}
              >
                <DockTabContent tab={tab} />
              </div>
            )
          })
        ) : (
          <EmptyDockState />
        )}
      </div>
    </aside>
  )
}

function EmptyDockState() {
  return (
    <div
      data-testid="dock-empty-state"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 280 }}>
        <div
          style={{
            color: colors.text.secondary,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform
          }}
        >
          no surface open
        </div>
        <div
          style={{
            marginTop: 8,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            lineHeight: 1.8
          }}
        >
          use the ribbon on the right edge to open the editor, canvas, graph, ghosts, or health, or
          press ⌘K for the command palette
        </div>
      </div>
    </div>
  )
}
