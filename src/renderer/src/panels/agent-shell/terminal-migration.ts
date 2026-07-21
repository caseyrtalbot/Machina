import { createCanvasNode, type CanvasNode, type CanvasViewport } from '@shared/canvas-types'
import { getCanvasStore, type CanvasStoreApi } from '../../store/canvas-store'
import { getFocusedCanvasId, useDockStore } from '../../store/dock-store'
import { useTerminalStripStore } from '../../store/terminal-strip-store'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'

/**
 * Terminal strip commands + dock↔canvas migration (workstation step 4).
 *
 * Migration is not a new subsystem — it names the existing seam (contracts §3):
 * the new surface mounts a webview whose terminal:reconnect replays the ring
 * buffer and re-registers the session to the new webContents. The one rule that
 * must hold: the PTY is never killed while a session changes surfaces.
 */

/** World coordinate at the center of the given viewport. Exported for tests. */
export function viewportWorldCenter(
  viewport: CanvasViewport,
  surface: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: (-viewport.x + surface.width / 2) / viewport.zoom,
    y: (-viewport.y + surface.height / 2) / viewport.zoom
  }
}

/**
 * Move a strip session onto the focused canvas as a terminal card.
 * Order: create the card, reveal the canvas (its webview reconnects and takes
 * over the session), then detach from the strip — detach never kills the PTY.
 * Null when no canvas tab is focused (the UI disables the action then).
 */
export function stripToCanvas(threadId: string, tabId: string): CanvasNode | null {
  const strip = useTerminalStripStore.getState()
  const session = strip.byThreadId[threadId]?.sessions.find((s) => s.tabId === tabId)
  // No sessionId yet means there is no PTY to hand over (the UI disables the
  // action, this is the belt-and-suspenders check).
  if (!session || !session.sessionId) return null

  const canvasId = getFocusedCanvasId()
  if (!canvasId) return null
  const store = getCanvasStore(canvasId)
  const center = viewportWorldCenter(store.getState().viewport, {
    width: typeof window === 'undefined' ? 1920 : window.innerWidth,
    height: typeof window === 'undefined' ? 1080 : window.innerHeight
  })
  const node = createCanvasNode('terminal', center, {
    content: session.sessionId,
    metadata: { initialCwd: session.cwd }
  })
  store.getState().addNode(node)
  useDockStore.getState().openOrFocusDockTab({ kind: 'canvas', id: canvasId })
  strip.detach(threadId, tabId)
  return node
}

/**
 * Move a terminal card from its canvas into the strip of the active thread.
 * The caller passes the card's own canvas store — the card knows which canvas
 * it lives on; nothing here guesses. Order mirrors stripToCanvas: attach first
 * (the strip webview reconnects), then remove the card with preserveSession so
 * the PTY survives.
 */
export function canvasToStrip(canvas: CanvasStoreApi, node: CanvasNode): boolean {
  const threadId = useThreadStore.getState().activeThreadId
  if (!threadId || node.type !== 'terminal' || !node.content) return false
  const cwd =
    typeof node.metadata?.initialCwd === 'string' && node.metadata.initialCwd
      ? node.metadata.initialCwd
      : (useVaultStore.getState().vaultPath ?? '/')
  useTerminalStripStore.getState().attach(threadId, { sessionId: node.content, cwd })
  canvas.getState().removeNode(node.id, { preserveSession: true })
  return true
}

/**
 * Spawn a strip terminal on the active thread. Defaults to the workspace root;
 * expands a collapsed dock so the new session is visible.
 */
export function openStripTerminal(cwd?: string): string | null {
  const threadId = useThreadStore.getState().activeThreadId
  const root = cwd ?? useVaultStore.getState().vaultPath
  if (!threadId || !root) return null
  const dock = useDockStore.getState()
  if (dock.dockCollapsed) dock.toggleDock()
  return useTerminalStripStore.getState().spawn(threadId, root)
}

/** Folder-picker spawn: any directory, deliberately unguarded (spawn-anywhere). */
export async function openStripTerminalInFolder(): Promise<string | null> {
  const dir = await window.api.fs.selectVault()
  if (!dir) return null
  return openStripTerminal(dir)
}

/**
 * ctrl+` behavior: reveal the strip if any part of it is hidden, hide it if
 * fully visible. No sessions → spawn one at the workspace root.
 */
export function toggleTerminalStrip(): void {
  const threadId = useThreadStore.getState().activeThreadId
  if (!threadId) return
  const strip = useTerminalStripStore.getState().byThreadId[threadId]
  if (!strip || strip.sessions.length === 0) {
    openStripTerminal()
    return
  }
  const dock = useDockStore.getState()
  if (dock.dockCollapsed) {
    // Reveal intent: expand the dock, and only un-collapse the strip — never
    // flip an expanded strip to collapsed while bringing the dock back.
    dock.toggleDock()
    if (strip.collapsed) useTerminalStripStore.getState().toggleCollapsed(threadId)
    return
  }
  useTerminalStripStore.getState().toggleCollapsed(threadId)
}
