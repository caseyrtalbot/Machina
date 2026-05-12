import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Activity,
  FileText,
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
import { borderRadius, colors, transitions } from '../../design/tokens'
import { useThreadStore } from '../../store/thread-store'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'

interface SideDockRibbonProps {
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
  const openOrFocusDockTab = useThreadStore((s) => s.openOrFocusDockTab)
  const toggleAutoAccept = useThreadStore((s) => s.toggleAutoAccept)
  const cancelActive = useThreadStore((s) => s.cancelActive)
  const inFlight = useThreadStore((s) =>
    s.activeThreadId ? Boolean(s.inFlightByThreadId[s.activeThreadId]) : false
  )

  function openSurface(tab: DockTab) {
    openOrFocusDockTab(tab)
  }

  async function openEditor() {
    const editorState = useEditorStore.getState()
    const fallback = editorState.activeNotePath ?? editorState.openTabs[0]?.path ?? null
    if (fallback) {
      openOrFocusDockTab({ kind: 'editor', path: fallback })
      return
    }
    // No prior note — create an Untitled scratch note in the vault root and open it.
    const vaultPath = useVaultStore.getState().vaultPath
    if (!vaultPath) return
    const today = new Date().toISOString().slice(0, 10)
    const title = `Untitled ${today}`
    const filePath = `${vaultPath}/${title}.md`
    const exists = await window.api.fs.fileExists(filePath)
    if (!exists) {
      const content = `---\ntitle: ${title}\ncreated: ${today}\ntags: []\n---\n\n`
      await window.api.fs.writeFile(filePath, content)
    }
    editorState.openTab(filePath, title)
    openOrFocusDockTab({ kind: 'editor', path: filePath })
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
      </RibbonGroup>

      <RibbonDivider />

      <RibbonGroup>
        <RibbonAction label="Open editor" icon={FileText} onClick={() => void openEditor()} />
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
          onClick={() => activeId && toggleAutoAccept(activeId)}
          disabled={!canToggleAutoAccept || !activeId}
          pressed={autoAcceptOn}
          tone={autoAcceptOn ? 'active' : 'default'}
        />
      </RibbonGroup>

      <div style={{ flex: 1, minHeight: 12 }} />

      {onOpenSettings && (
        <RibbonAction label="Open settings" icon={Settings} onClick={onOpenSettings} />
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
        margin: '8px 0',
        background: 'var(--line-subtle)'
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
    interactive && hovered
      ? tone === 'danger'
        ? 'color-mix(in srgb, #ff847d 10%, transparent)'
        : 'color-mix(in srgb, var(--color-text-primary) 5%, transparent)'
      : 'transparent'

  const style: CSSProperties = {
    width: ACTION_WIDTH,
    height: ACTION_HEIGHT,
    padding: '4px 6px',
    boxSizing: 'border-box',
    border: 'none',
    borderRadius: borderRadius.inline,
    background,
    color,
    cursor: interactive ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    transition: `background ${transitions.fast}, color ${transitions.fast}`
  }

  return (
    <button
      type="button"
      className="side-dock-ribbon-action"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-active={isActive ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
    >
      {isActive ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -3,
            top: 4,
            bottom: 4,
            width: 2,
            background: colors.accent.default,
            borderRadius: 1
          }}
        />
      ) : null}
      <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
