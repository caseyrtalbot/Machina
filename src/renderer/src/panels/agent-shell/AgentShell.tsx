import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useThreadStore } from '../../store/thread-store'
import { useThreadStreaming } from '../../hooks/use-thread-streaming'
import { ThreadSidebar } from './ThreadSidebar'
import { ThreadPanel } from './ThreadPanel'
import { SurfaceDock } from './SurfaceDock'
import { CommandPalette } from './CommandPalette'
import { SideDockRibbon } from './SideDockRibbon'
import { ResizeHandle } from './ResizeHandle'
import { useAgentShellKeybindings } from './keybindings'
import { borderRadius, colors, typography } from '../../design/tokens'

const WINDOW_HEADER_HEIGHT = 39
const WINDOW_CONTROLS_CONTAINER_WIDTH = 148

export interface AgentShellProps {
  readonly onOpenSettings?: () => void
}

export function AgentShell({ onOpenSettings }: AgentShellProps = {}) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useThreadStore((s) => s.setVaultPath)
  const loadThreads = useThreadStore((s) => s.loadThreads)
  const loadLayout = useThreadStore((s) => s.loadLayout)
  const toggleDock = useThreadStore((s) => s.toggleDock)
  const dockCollapsed = useThreadStore((s) => s.dockCollapsed)
  const sidebarWidth = useThreadStore((s) => s.sidebarWidth)
  const dockWidth = useThreadStore((s) => s.dockWidth)
  const setSidebarWidth = useThreadStore((s) => s.setSidebarWidth)
  const setDockWidth = useThreadStore((s) => s.setDockWidth)
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
        await store.selectThread(sorted[0].id)
      } else {
        await store.createThread('machina-native', 'claude-sonnet-4-6', 'Welcome')
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
      <WindowDragRegion />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ThreadSidebar onOpenSettings={onOpenSettings} width={sidebarWidth} />
        <ResizeHandle
          side="sidebar"
          width={sidebarWidth}
          onChange={setSidebarWidth}
          onCommit={() => void persistLayout()}
        />
        <ThreadPanel />
        <SideDockRibbon onOpenPalette={openPalette} onOpenSettings={onOpenSettings} />
        {!dockCollapsed && (
          <ResizeHandle
            side="dock"
            width={dockWidth}
            onChange={setDockWidth}
            onCommit={() => void persistLayout()}
          />
        )}
        <SurfaceDock width={dockWidth} />
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <WelcomeTooltip vaultPath={vaultPath} />
    </div>
  )
}

function WindowDragRegion() {
  // Reserve an Obsidian-sized 148x39 titlebar control zone across the left of
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
      aria-hidden
      style={{
        display: 'flex',
        height: WINDOW_HEADER_HEIGHT,
        flexShrink: 0,
        paddingLeft: 8,
        paddingRight: 8,
        boxSizing: 'border-box',
        background: colors.bg.chrome,
        borderBottom: `1px solid ${colors.border.subtle}`
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
        style={{
          flex: 1,
          minWidth: 0,
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'drag'
        }}
      />
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
        bottom: 24,
        right: 24,
        maxWidth: 320,
        padding: '14px 16px',
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.tool,
        color: colors.text.primary,
        fontFamily: typography.fontFamily.body,
        fontSize: 13,
        lineHeight: 1.5,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        zIndex: 1000
      }}
    >
      <div style={{ marginBottom: 10 }}>
        this is your agent shell. type to chat, hit <code>/</code> to switch agent,{' '}
        <code>Cmd-K</code> for the palette.
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.border.default}`,
          color: colors.text.secondary,
          padding: '4px 10px',
          borderRadius: borderRadius.inline,
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          cursor: 'pointer'
        }}
      >
        got it
      </button>
    </div>
  )
}
