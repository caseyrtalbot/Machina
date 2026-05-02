import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useThreadStore } from '../../store/thread-store'
import { useThreadStreaming } from '../../hooks/use-thread-streaming'
import { ThreadSidebar } from './ThreadSidebar'
import { ThreadPanel } from './ThreadPanel'
import { SurfaceDock } from './SurfaceDock'
import { CommandPalette } from './CommandPalette'
import { useAgentShellKeybindings } from './keybindings'
import { colors } from '../../design/tokens'

export interface AgentShellProps {
  readonly onOpenSettings?: () => void
}

export function AgentShell({ onOpenSettings }: AgentShellProps = {}) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useThreadStore((s) => s.setVaultPath)
  const loadThreads = useThreadStore((s) => s.loadThreads)
  const toggleDock = useThreadStore((s) => s.toggleDock)

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
      await loadThreads()
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
  }, [vaultPath, setVaultPath, loadThreads])

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
        <ThreadSidebar onOpenSettings={onOpenSettings} />
        <ThreadPanel />
        <SurfaceDock />
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <WelcomeTooltip vaultPath={vaultPath} />
    </div>
  )
}

function WindowDragRegion() {
  // Reserve a 28px band across the top of the shell so the OS can drag the
  // window. Sits above the three-pane layout (no overlap), which keeps
  // interactive elements pointer-clickable without per-button no-drag wiring.
  // 28px also clears the traffic lights at trafficLightPosition { x: 12, y: 12 }.
  return (
    <div
      data-testid="window-drag-region"
      aria-hidden
      style={{
        height: 28,
        flexShrink: 0,
        // @ts-expect-error -- Electron-only CSS property
        WebkitAppRegion: 'drag'
      }}
    />
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
        borderRadius: 8,
        color: colors.text.primary,
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
          border: `1px solid ${colors.border.subtle}`,
          color: colors.text.secondary,
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        got it
      </button>
    </div>
  )
}
