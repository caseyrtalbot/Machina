import type { ReactNode } from 'react'
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
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import type { DockTab } from '@shared/dock-types'
import { useThreadStore } from '../../store/thread-store'
import { openNoteInEditor, useDockStore } from '../../store/dock-store'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { openStripTerminal } from './terminal-migration'

interface SideDockRibbonProps {
  readonly onOpenPalette: () => void
  readonly onOpenSettings?: () => void
}

const ICON_SIZE = 18

export function SideDockRibbon({ onOpenPalette, onOpenSettings }: SideDockRibbonProps) {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? (s.threadsById[s.activeThreadId] ?? null) : null
  )
  const dockCollapsed = useDockStore((s) => s.dockCollapsed)
  const toggleDock = useDockStore((s) => s.toggleDock)
  const openOrFocusDockTab = useDockStore((s) => s.openOrFocusDockTab)
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
    if (editorState.activeNotePath || editorState.openTabs.length > 0) {
      // Editor-store already has notes — just surface the singleton editor tab.
      openOrFocusDockTab({ kind: 'editor' })
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
    openNoteInEditor(filePath, { title })
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
        <RibbonAction
          label="New terminal"
          icon={SquareTerminal}
          onClick={() => openStripTerminal()}
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

      <div className="te-dock-ribbon-spacer" />

      {onOpenSettings && (
        <RibbonAction label="Open settings" icon={Settings} onClick={onOpenSettings} />
      )}
    </nav>
  )
}

function RibbonGroup({ children }: { readonly children: ReactNode }) {
  return <div className="te-dock-ribbon-group">{children}</div>
}

function RibbonDivider() {
  return <div aria-hidden className="te-dock-ribbon-divider" />
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
  const isActive = pressed === true || tone === 'active'

  return (
    <button
      type="button"
      className="side-dock-ribbon-action"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-active={isActive ? 'true' : undefined}
      data-tone={tone === 'danger' ? 'danger' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {isActive ? <span aria-hidden className="te-dock-ribbon-active-bar" /> : null}
      <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
