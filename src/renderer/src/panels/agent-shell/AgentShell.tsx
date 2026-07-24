import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useThreadStore } from '../../store/thread-store'
import { useDockStore } from '../../store/dock-store'
import { useThreadStreaming } from '../../hooks/use-thread-streaming'
import { PanelLeft, MessageSquare } from 'lucide-react'
import { ThreadSidebar } from './ThreadSidebar'
import { ThreadPanel } from './ThreadPanel'
import { SurfaceDock } from './SurfaceDock'
import { CommandPalette } from './CommandPalette'
import { HarnessGallery } from './HarnessGallery'
import { HarnessTaskBriefDialog } from './HarnessTaskBriefDialog'
import { SideDockRibbon } from './SideDockRibbon'
import { HeaderFilesSidePanel, HeaderFilesToggleButton } from './HeaderFilesSidePanel'
import { ApprovalsTray } from './ApprovalsTray'
import { TitlebarPanelToggle } from './TitlebarPanelToggle'
import { ResizeHandle } from './ResizeHandle'
import { StaticDivider } from './StaticDivider'
import { useAgentShellKeybindings } from './keybindings'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { TitlebarBreadcrumb } from '../../components/TitlebarBreadcrumb'
import { Statusbar } from '../../components/Statusbar'
import type { HarnessSummary } from '@shared/harness-types'

interface AgentShellProps {
  readonly onOpenSettings?: () => void
  readonly onChangeVault?: () => void
}

export function AgentShell({ onOpenSettings, onChangeVault }: AgentShellProps = {}) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useThreadStore((s) => s.setVaultPath)
  const loadThreads = useThreadStore((s) => s.loadThreads)
  const loadLayout = useThreadStore((s) => s.loadLayout)
  const toggleDock = useDockStore((s) => s.toggleDock)
  const dockCollapsed = useDockStore((s) => s.dockCollapsed)
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
  const [galleryState, setGalleryState] = useState<{
    readonly templateId?: string
    readonly revision: number
  } | null>(null)
  const [taskBriefHarness, setTaskBriefHarness] = useState<HarnessSummary | null>(null)
  const openPalette = useCallback(() => {
    if (galleryState === null && taskBriefHarness === null) setPaletteOpen(true)
  }, [galleryState, taskBriefHarness])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openHarnessGallery = useCallback((templateId?: string) => {
    setPaletteOpen(false)
    setGalleryState((current) => ({ templateId, revision: (current?.revision ?? 0) + 1 }))
  }, [])
  const closeHarnessGallery = useCallback(() => setGalleryState(null), [])
  const openHarnessTaskBrief = useCallback((summary: HarnessSummary) => {
    setPaletteOpen(false)
    setGalleryState(null)
    setTaskBriefHarness(summary)
  }, [])
  const closeHarnessTaskBrief = useCallback(() => setTaskBriefHarness(null), [])

  const keybindingOpts = useMemo(
    () => ({ toggleDock, openPalette, closePalette }),
    [toggleDock, openPalette, closePalette]
  )
  useAgentShellKeybindings(keybindingOpts)

  return (
    <div data-testid="agent-shell" className="te-shell-root">
      <WindowDragRegion
        centerSlot={<TitlebarBreadcrumb />}
        rightSlot={
          <>
            <ApprovalsTray />
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
      <div className="te-shell-body">
        {!sidebarCollapsed && (
          <>
            <ThreadSidebar
              width={sidebarWidth}
              onChangeVault={onChangeVault}
              onOpenHarnessGallery={() => openHarnessGallery()}
            />
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
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onOpenHarnessGallery={openHarnessGallery}
        onOpenHarnessTaskBrief={openHarnessTaskBrief}
      />
      {galleryState !== null && (
        <HarnessGallery
          key={galleryState.revision}
          open
          initialTemplateId={galleryState.templateId}
          onClose={closeHarnessGallery}
          onRequestRun={openHarnessTaskBrief}
        />
      )}
      {taskBriefHarness !== null && (
        <HarnessTaskBriefDialog
          key={taskBriefHarness.slug}
          summary={taskBriefHarness}
          onClose={closeHarnessTaskBrief}
        />
      )}
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
    <div data-testid="window-drag-region" className="te-shell-titlebar">
      <div
        data-testid="window-controls-container"
        className="te-shell-titlebar-controls"
        style={{
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'drag'
        }}
      />
      <div
        aria-hidden
        className="te-shell-titlebar-drag"
        style={{
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'drag'
        }}
      >
        {centerSlot}
      </div>
      {rightSlot && (
        <div
          data-testid="window-header-right-slot"
          className="te-shell-titlebar-actions"
          style={{
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
      className="te-shell-welcome"
    >
      <div className="te-shell-welcome-eyebrow">Welcome</div>
      <div className="te-shell-welcome-body">
        Type to chat, <WelcomeKbd>/</WelcomeKbd> to switch agent, <WelcomeKbd>⌘K</WelcomeKbd> for
        the palette.
      </div>
      <div className="te-shell-welcome-footer">
        <button type="button" onClick={dismiss} className="te-shell-welcome-dismiss">
          Got it
        </button>
      </div>
    </div>
  )
}

function WelcomeKbd({ children }: { readonly children: React.ReactNode }) {
  return <span className="te-shell-kbd">{children}</span>
}
