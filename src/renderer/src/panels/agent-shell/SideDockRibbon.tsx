import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Activity,
  MessageSquarePlus,
  Network,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  type LucideIcon
} from 'lucide-react'
import type { DockTab } from '@shared/dock-types'
import type { AgentIdentity } from '@shared/agent-identity'
import { borderRadius, colors } from '../../design/tokens'
import { useThreadStore } from '../../store/thread-store'
import { AgentPicker } from './AgentPicker'

export interface SideDockRibbonProps {
  readonly onOpenPalette: () => void
  readonly onOpenSettings?: () => void
}

const RIBBON_WIDTH = 35
const ACTION_WIDTH = 30
const ACTION_HEIGHT = 26
const ICON_SIZE = 18

export function SideDockRibbon({ onOpenPalette, onOpenSettings }: SideDockRibbonProps) {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? (s.threadsById[s.activeThreadId] ?? null) : null
  )
  const dockCollapsed = useThreadStore((s) => s.dockCollapsed)
  const toggleDock = useThreadStore((s) => s.toggleDock)
  const addDockTab = useThreadStore((s) => s.addDockTab)
  const createThread = useThreadStore((s) => s.createThread)
  const toggleAutoAccept = useThreadStore((s) => s.toggleAutoAccept)
  const cancelActive = useThreadStore((s) => s.cancelActive)
  const inFlight = useThreadStore((s) =>
    s.activeThreadId ? Boolean(s.inFlightByThreadId[s.activeThreadId]) : false
  )
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)

  function openSurface(tab: DockTab) {
    addDockTab(tab)
  }

  async function pickAgent(agent: AgentIdentity) {
    setAgentPickerOpen(false)
    await createThread(agent, 'claude-sonnet-4-6')
  }

  const canToggleAutoAccept = activeThread?.agent === 'machina-native'
  const autoAcceptOn = activeThread?.autoAcceptSession === true
  const DockIcon = dockCollapsed ? PanelRightOpen : PanelRightClose
  const AutoAcceptIcon = autoAcceptOn ? ShieldCheck : ShieldAlert

  return (
    <nav
      className="side-dock-ribbon"
      data-testid="side-dock-ribbon"
      aria-label="Surface dock ribbon"
      style={{
        width: RIBBON_WIDTH,
        height: '100%',
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '4px 2px 8px 3px',
        background: colors.bg.rail,
        borderLeft: `1px solid ${colors.border.subtle}`,
        borderRight: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        position: 'relative'
      }}
    >
      <RibbonGroup>
        <RibbonAction
          label={dockCollapsed ? 'Expand surface dock' : 'Collapse surface dock'}
          icon={DockIcon}
          onClick={toggleDock}
          pressed={!dockCollapsed}
        />
        <RibbonAction label="Open command palette" icon={Search} onClick={onOpenPalette} />
        <RibbonAction
          label="New thread"
          icon={MessageSquarePlus}
          onClick={() => setAgentPickerOpen(true)}
        />
      </RibbonGroup>

      <RibbonDivider />

      <RibbonGroup>
        <RibbonAction
          label="Open canvas"
          icon={PanelsTopLeft}
          onClick={() => openSurface({ kind: 'canvas', id: 'default' })}
        />
        <RibbonAction
          label="Open graph"
          icon={Network}
          onClick={() => openSurface({ kind: 'graph' })}
        />
        <RibbonAction
          label="Open ghosts"
          icon={Sparkles}
          onClick={() => openSurface({ kind: 'ghosts' })}
        />
        <RibbonAction
          label="Open health"
          icon={Activity}
          onClick={() => openSurface({ kind: 'health' })}
        />
      </RibbonGroup>

      <RibbonDivider />

      <RibbonGroup>
        {inFlight && activeId && (
          <RibbonAction
            label="Stop active run"
            icon={Square}
            onClick={() => void cancelActive(activeId)}
            tone="danger"
          />
        )}
        <RibbonAction
          label={autoAcceptOn ? 'Disable auto-accept' : 'Enable auto-accept'}
          icon={AutoAcceptIcon}
          onClick={() => activeId && void toggleAutoAccept(activeId)}
          disabled={!canToggleAutoAccept || !activeId}
          pressed={autoAcceptOn}
          tone={autoAcceptOn ? 'active' : 'default'}
        />
      </RibbonGroup>

      <div style={{ flex: 1, minHeight: 12 }} />

      {onOpenSettings && (
        <RibbonAction label="Open settings" icon={Settings} onClick={onOpenSettings} />
      )}

      {agentPickerOpen && (
        <AgentPicker onPick={pickAgent} onCancel={() => setAgentPickerOpen(false)} />
      )}
    </nav>
  )
}

function RibbonGroup({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {children}
    </div>
  )
}

function RibbonDivider() {
  return (
    <div
      aria-hidden
      style={{
        width: 18,
        height: 1,
        margin: '6px 0',
        background: colors.border.subtle
      }}
    />
  )
}

function RibbonAction({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  pressed,
  tone = 'default'
}: {
  readonly label: string
  readonly icon: LucideIcon
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly pressed?: boolean
  readonly tone?: 'default' | 'active' | 'danger'
}) {
  const [hovered, setHovered] = useState(false)
  const interactive = !disabled
  const isActive = pressed === true || tone === 'active'
  const color = disabled
    ? colors.text.disabled
    : tone === 'danger'
      ? colors.claude.error
      : isActive
        ? colors.accent.default
        : hovered
          ? colors.text.primary
          : colors.text.secondary
  const background =
    interactive && (hovered || isActive)
      ? tone === 'danger'
        ? 'color-mix(in srgb, #ff847d 10%, transparent)'
        : 'color-mix(in srgb, var(--color-accent-default) 10%, transparent)'
      : 'transparent'
  const border =
    interactive && isActive
      ? colors.accent.line
      : interactive && hovered
        ? colors.border.default
        : 'transparent'

  const style: CSSProperties = {
    width: ACTION_WIDTH,
    height: ACTION_HEIGHT,
    padding: '4px 6px',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: borderRadius.inline,
    background,
    color,
    cursor: interactive ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out'
  }

  return (
    <button
      type="button"
      className="side-dock-ribbon-action"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
    >
      <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
