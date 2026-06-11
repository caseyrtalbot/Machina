import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useThreadStore } from '../../store/thread-store'
import { useThreadStreaming } from '../../hooks/use-thread-streaming'
import { PanelLeft, MessageSquare } from 'lucide-react'
import { ThreadSidebar } from './ThreadSidebar'
import { ThreadPanel } from './ThreadPanel'
import { SurfaceDock } from './SurfaceDock'
import { CommandPalette } from './CommandPalette'
import { SideDockRibbon } from './SideDockRibbon'
import { HeaderFilesSidePanel, HeaderFilesToggleButton } from './HeaderFilesSidePanel'
import { TitlebarPanelToggle } from './TitlebarPanelToggle'
import { ResizeHandle } from './ResizeHandle'
import { StaticDivider } from './StaticDivider'
import { useAgentShellKeybindings } from './keybindings'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { borderRadius, colors, floatingPanel, transitions, typography } from '../../design/tokens'
import { TitlebarBreadcrumb } from '../../components/TitlebarBreadcrumb'
import { Statusbar } from '../../components/Statusbar'

const WINDOW_HEADER_HEIGHT = 39
const WINDOW_CONTROLS_CONTAINER_WIDTH = 148

interface AgentShellProps {
  readonly onOpenSettings?: () => void
  readonly onChangeVault?: () => void
}

export function AgentShell({ onOpenSettings, onChangeVault }: AgentShellProps = {}) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useThreadStore((s) => s.setVaultPath)
  const loadThreads = useThreadStore((s) => s.loadThreads)
  const loadLayout = useThreadStore((s) => s.loadLayout)
  const toggleDock = useThreadStore((s) => s.toggleDock)
  const dockCollapsed = useThreadStore((s) => s.dockCollapsed)
  const sidebarWidth = useThreadStore((s) => s.sidebarWidth)
  const chatWidth = useThreadStore((s) => s.chatWidth)
  const sidebarCollapsed = useThreadStore((s) => s.sidebarCollapsed)
  const chatCollapsed = useThreadStore((s) => s.chatCollapsed)
  const filesPanelOpen = useThreadStore((s) => s.filesPanelOpen)
  const setSidebarWidth = useThreadStore((s) => s.setSidebarWidth)
  const setChatWidth = useThreadStore((s) => s.setChatWidth)
  const toggleSidebarCollapsed = useThreadStore((s) => s.toggleSidebarCollapsed)
  const toggleChatCollapsed = useThreadStore((s) => s.toggleChatCollapsed)
  const toggleFilesPanel = useThreadStore((s) => s.toggleFilesPanel)
  const closeFilesPanel = useThreadStore((s) => s.closeFilesPanel)
  const persistLayout = useThreadStore((s) => s.persistLayout)

  // Boot-route once per vaultPath: select the most recent thread or create a
  // welcome thread on first launch. Ref guard prevents StrictMode double-mount
  // from creating duplicate welcome threads.
  const bootedForVaultRef = useRef<string | null>(null)
  useEffect(() => {
    if (!vaultPath) return
    setVaultPath(vaultPath)
    if (bootedForVaultRef.current === vaultPath) return
    bootedForVaultRef.current = vaultPath
    void (async () => {
      await Promise.all([loadThreads(), loadLayout()])
      const store = useThreadStore.getState()
      if (store.activeThreadId) return
      const threads = Object.values(store.threadsById)
      if (threads.length > 0) {
        const sorted = [...threads].sort((a, b) => b.lastMessage.localeCompare(a.lastMessage))
        // reveal:false — boot restoration must not defeat a persisted
        // chat-collapsed layout the way a user click intentionally does.
        await store.selectThread(sorted[0].id, { reveal: false })
      } else {
        await store.createThread('machina-native', DEFAULT_NATIVE_MODEL, 'Welcome')
      }
    })()
  }, [vaultPath, setVaultPath, loadThreads, loadLayout])

  useThreadStreaming()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  const keybindingOpts = useMemo(
    () => ({ toggleDock, openPalette, closePalette }),
    [toggleDock, openPalette, closePalette]
  )
  useAgentShellKeybindings(keybindingOpts)

  return (
    <div
      data-testid="agent-shell"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
    >
      <WindowDragRegion
        centerSlot={<TitlebarBreadcrumb />}
        rightSlot={
          <>
            <TitlebarPanelToggle
              open={!sidebarCollapsed}
              onToggle={toggleSidebarCollapsed}
              expandLabel="Expand threads"
              collapseLabel="Collapse threads"
              title="Threads"
            >
              <PanelLeft size={15} strokeWidth={1.75} aria-hidden />
            </TitlebarPanelToggle>
            <TitlebarPanelToggle
              open={!chatCollapsed}
              onToggle={toggleChatCollapsed}
              expandLabel="Expand chat"
              collapseLabel="Collapse chat"
              title="Chat"
            >
              <MessageSquare size={15} strokeWidth={1.75} aria-hidden />
            </TitlebarPanelToggle>
            <HeaderFilesToggleButton open={filesPanelOpen} onToggle={toggleFilesPanel} />
          </>
        }
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {!sidebarCollapsed && (
          <>
            <ThreadSidebar width={sidebarWidth} onChangeVault={onChangeVault} />
            <ResizeHandle
              side="sidebar"
              width={sidebarWidth}
              onChange={setSidebarWidth}
              onCommit={() => void persistLayout()}
            />
          </>
        )}
        {!chatCollapsed && (
          <>
            {/* Dock visible: chat holds a fixed width and the dock flexes.
                Dock collapsed: chat is the last surface standing and flexes. */}
            <ThreadPanel width={dockCollapsed ? undefined : chatWidth} />
            {dockCollapsed ? (
              <StaticDivider />
            ) : (
              <ResizeHandle
                side="chat"
                width={chatWidth}
                onChange={setChatWidth}
                onCommit={() => void persistLayout()}
              />
            )}
          </>
        )}
        <SideDockRibbon onOpenPalette={openPalette} onOpenSettings={onOpenSettings} />
        <SurfaceDock />
        <HeaderFilesSidePanel
          open={filesPanelOpen}
          onClose={closeFilesPanel}
          onChangeVault={onChangeVault}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <Statusbar />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <WelcomeTooltip vaultPath={vaultPath} />
    </div>
  )
}

function WindowDragRegion({
  centerSlot,
  rightSlot
}: {
  readonly centerSlot?: ReactNode
  readonly rightSlot?: ReactNode
}) {
  // Reserve a 148x39 titlebar control zone across the left of
  // the shell and keep the rest of the header draggable. The strip sits above
  // the three-pane layout, so interactive elements stay pointer-clickable
  // without per-button no-drag wiring.
  //
  // The drag region is inset 8px from the left and right so macOS keeps
  // ownership of the corner resize hit zones. Without these gutters, the drag
  // region wins over OS resize at the corners.
  return (
    <div
      data-testid="window-drag-region"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: WINDOW_HEADER_HEIGHT,
        flexShrink: 0,
        paddingLeft: 8,
        paddingRight: 8,
        boxSizing: 'border-box',
        background: colors.bg.chrome,
        borderBottom: `1px solid var(--line-subtle)`
      }}
    >
      <div
        data-testid="window-controls-container"
        style={{
          width: WINDOW_CONTROLS_CONTAINER_WIDTH,
          height: WINDOW_HEADER_HEIGHT,
          flexShrink: 0,
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'drag'
        }}
      />
      <div
        aria-hidden
        style={{
          flex: 1,
          minWidth: 0,
          height: WINDOW_HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'drag'
        }}
      >
        {centerSlot}
      </div>
      {rightSlot && (
        <div
          data-testid="window-header-right-slot"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            // @ts-expect-error -- Electron-only CSS property
            WebkitAppRegion: 'no-drag'
          }}
        >
          {rightSlot}
        </div>
      )}
    </div>
  )
}

function WelcomeTooltip({ vaultPath }: { readonly vaultPath: string | null }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!vaultPath) return
    let cancelled = false
    void window.api.thread.readConfig(vaultPath).then((cfg) => {
      if (!cancelled && cfg.welcomed === false) setShow(true)
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  const dismiss = useCallback(() => {
    setShow(false)
    if (!vaultPath) return
    void window.api.thread.readConfig(vaultPath).then((cfg) => {
      void window.api.thread.writeConfig(vaultPath, { ...cfg, welcomed: true })
    })
  }, [vaultPath])

  if (!show) return null

  return (
    <div
      data-testid="agent-shell-welcome-tooltip"
      role="dialog"
      aria-label="welcome"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        maxWidth: 300,
        padding: '12px 16px',
        background: floatingPanel.glass.bg,
        backdropFilter: floatingPanel.glass.blur,
        WebkitBackdropFilter: floatingPanel.glass.blur,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: floatingPanel.borderRadius,
        color: colors.text.primary,
        fontFamily: typography.fontFamily.body,
        fontSize: 13,
        lineHeight: 1.55,
        boxShadow: floatingPanel.shadowCompact,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted
        }}
      >
        Welcome
      </div>
      <div style={{ color: colors.text.secondary }}>
        Type to chat, <WelcomeKbd>/</WelcomeKbd> to switch agent, <WelcomeKbd>⌘K</WelcomeKbd> for
        the palette.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <button
          type="button"
          onClick={dismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.text.muted,
            padding: '2px 4px',
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform,
            cursor: 'pointer',
            transition: `color ${transitions.focusRing}`
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = colors.text.primary)}
          onMouseLeave={(e) => (e.currentTarget.style.color = colors.text.muted)}
        >
          Got it
        </button>
      </div>
    </div>
  )
}

function WelcomeKbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        margin: '0 2px',
        verticalAlign: 'baseline',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: borderRadius.inline,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        color: colors.text.primary,
        background: 'transparent'
      }}
    >
      {children}
    </span>
  )
}
