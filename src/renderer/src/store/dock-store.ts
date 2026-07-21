import { create } from 'zustand'
import { DOCK_TAB_KINDS, type DockTab } from '@shared/dock-types'
import type { Thread } from '@shared/thread-types'
import { TE_DIR } from '@shared/constants'
import { useEditorStore } from './editor-store'
import { useTerminalStripStore } from './terminal-strip-store'
import { useThreadStore } from './thread-store'

/**
 * Per-thread dock tab + dock layout state (workstation Phase 3 step 3),
 * extracted from thread-store to keep that file under the 800-line cap.
 *
 * Import-cycle contract: this module and thread-store import each other.
 * That is safe ONLY because neither module's top level reads the other's
 * bindings — all cross-store access happens inside actions, subscribers, or
 * the hoisted `flushDockState` function declaration.
 * Keep it that way: a top-level `useThreadStore.…` call here (or a top-level
 * read of a non-function export from this file over there) breaks under the
 * ESM cycle depending on which module loads first.
 *
 * Cross-store atomicity caveat: the chat↔dock never-both-collapsed mirror
 * (`toggleDock` here / `toggleChatCollapsed` in thread-store) now spans TWO
 * sequential setState calls, one per store — not one atomic set as when both
 * flags lived in thread-store. Between the two sets, a non-React subscriber
 * could observe dockCollapsed and chatCollapsed both true. Benign today
 * (React 18 batches the renders; persistLayout reads final state) — do NOT
 * add a subscriber that acts on
 * the collapsed-flag pair mid-action; read it only after both sets settle.
 */
interface DockState {
  dockTabsByThreadId: Record<string, DockTab[]>
  dockActiveIndexByThreadId: Record<string, number>
  dockCollapsed: boolean

  addDockTab: (tab: DockTab) => void
  openOrFocusDockTab: (tab: DockTab) => void
  removeDockTab: (index: number) => void
  removeDockTabs: (indices: readonly number[]) => void
  reorderDockTab: (from: number, to: number) => void
  setDockActiveIndex: (threadId: string, index: number) => void
  toggleDock: () => void
  setDockCollapsed: (collapsed: boolean) => void

  /** Disk-authoritative reseed on thread load: replaces the whole tab map. */
  seedFromThreads: (threads: readonly Thread[]) => void
  /** Seed one thread's tabs (thread creation). */
  seedThreadTabs: (threadId: string, tabs: readonly DockTab[]) => void
  /** Replace one thread's tabs (validation drop path). */
  setThreadTabs: (threadId: string, tabs: DockTab[]) => void
  /** Forget a deleted thread's dock state. */
  dropThread: (threadId: string) => void
  /** Workspace switch: clear all per-thread dock state (dockCollapsed persists). */
  resetThreads: () => void
}

/**
 * Stable identity for focus-vs-open dedupe. Every kind except canvas is a
 * kind-keyed singleton — editor included: note identity lives in editor-store,
 * not in the dock tab (see dock-types.ts). The `kind: 'terminal'` DockTab
 * variant is retired (Phase 3 step 3): plain terminals live in the strip,
 * agent sessions in ThreadPanel's agent surface.
 */
function dockTabIdentity(t: DockTab): string {
  switch (t.kind) {
    case 'canvas':
      return `canvas:${t.id}`
    case 'editor':
    case 'graph':
    case 'ghosts':
    case 'health':
      return t.kind
  }
}

function activeThreadId(): string | null {
  return useThreadStore.getState().activeThreadId
}

/**
 * Disk seeds pass through the transparent thread-md decoder, so a legacy
 * thread file can carry shapes the current model retired:
 * - a retired tab kind (`terminal` predates Phase 3 step 3) — dropped; it has
 *   no render surface anymore.
 * - per-path `{ kind: 'editor', path }` tabs (predate the singleton editor
 *   surface) — folded to one `{ kind: 'editor' }` tab, with their paths
 *   harvested so the caller can restore them into editor-store's note tabs.
 */
function sanitizeTabs(raw: readonly DockTab[]): {
  tabs: DockTab[]
  legacyEditorPaths: string[]
} {
  const tabs: DockTab[] = []
  const legacyEditorPaths: string[] = []
  let hasEditor = false
  for (const t of raw) {
    if (!(DOCK_TAB_KINDS as readonly string[]).includes(t.kind)) continue
    if (t.kind === 'editor') {
      const legacyPath = (t as { path?: unknown }).path
      if (typeof legacyPath === 'string' && legacyPath !== '') legacyEditorPaths.push(legacyPath)
      if (!hasEditor) {
        tabs.push({ kind: 'editor' })
        hasEditor = true
      }
      continue
    }
    tabs.push(t)
  }
  return { tabs, legacyEditorPaths }
}

export const useDockStore = create<DockState>((set, get) => ({
  dockTabsByThreadId: {},
  dockActiveIndexByThreadId: {},
  dockCollapsed: false,

  addDockTab: (tab) => {
    const id = activeThreadId()
    if (!id) return
    set((s) => {
      const next = [...(s.dockTabsByThreadId[id] ?? []), tab]
      return {
        dockCollapsed: false,
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: next },
        dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [id]: next.length - 1 }
      }
    })
  },

  openOrFocusDockTab: (tab) => {
    const id = activeThreadId()
    if (!id) return
    set((s) => {
      const tabs = s.dockTabsByThreadId[id] ?? []
      const identity = dockTabIdentity(tab)
      const existingIdx = tabs.findIndex((t) => dockTabIdentity(t) === identity)
      if (existingIdx >= 0) {
        return {
          dockCollapsed: false,
          dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [id]: existingIdx }
        }
      }
      const next = [...tabs, tab]
      return {
        dockCollapsed: false,
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: next },
        dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [id]: next.length - 1 }
      }
    })
  },

  removeDockTab: (index) => {
    const id = activeThreadId()
    if (!id) return
    set((s) => {
      const tabs = (s.dockTabsByThreadId[id] ?? []).slice()
      if (index < 0 || index >= tabs.length) return s
      tabs.splice(index, 1)
      const prevActive = s.dockActiveIndexByThreadId[id] ?? 0
      // After splice: same index is now the next-right tab. Shift left if we
      // removed at-or-before the active tab; clamp to the last tab.
      const nextActive = Math.max(
        0,
        Math.min(prevActive >= index ? prevActive - 1 : prevActive, tabs.length - 1)
      )
      return {
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: tabs },
        dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [id]: nextActive }
      }
    })
  },

  removeDockTabs: (indices) => {
    if (indices.length === 0) return
    const id = activeThreadId()
    if (!id) return
    set((s) => {
      const drop = new Set(indices)
      const before = s.dockTabsByThreadId[id] ?? []
      const tabs = before.filter((_, i) => !drop.has(i))
      const prevActive = s.dockActiveIndexByThreadId[id] ?? 0
      const nextActive = Math.max(
        0,
        Math.min(
          prevActive - indices.filter((i) => i <= prevActive).length,
          Math.max(0, tabs.length - 1)
        )
      )
      return {
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: tabs },
        dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [id]: nextActive }
      }
    })
  },

  reorderDockTab: (from, to) => {
    const id = activeThreadId()
    if (!id) return
    set((s) => {
      const tabs = (s.dockTabsByThreadId[id] ?? []).slice()
      const [it] = tabs.splice(from, 1)
      tabs.splice(to, 0, it)
      return { dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: tabs } }
    })
  },

  setDockActiveIndex: (threadId, index) =>
    set((s) => {
      if (s.dockActiveIndexByThreadId[threadId] === index) return s
      return {
        dockActiveIndexByThreadId: { ...s.dockActiveIndexByThreadId, [threadId]: index }
      }
    }),

  toggleDock: () => {
    const collapsing = !get().dockCollapsed
    set({ dockCollapsed: collapsing })
    // Mirror of toggleChatCollapsed: never leave both panes collapsed.
    useThreadStore.setState((s) => ({
      chatCollapsed: collapsing ? false : s.chatCollapsed,
      focusMode: false,
      focusSnapshot: null
    }))
    void useThreadStore.getState().persistLayout()
  },

  setDockCollapsed: (collapsed) =>
    set((s) => (s.dockCollapsed === collapsed ? s : { dockCollapsed: collapsed })),

  seedFromThreads: (threads) => {
    const harvested: string[] = []
    set({
      dockTabsByThreadId: Object.fromEntries(
        threads.map((t) => {
          const { tabs, legacyEditorPaths } = sanitizeTabs(t.dockState.tabs)
          harvested.push(...legacyEditorPaths)
          return [t.id, tabs]
        })
      )
    })
    useEditorStore.getState().restoreTabs(harvested)
  },

  seedThreadTabs: (threadId, tabs) => {
    const { tabs: clean, legacyEditorPaths } = sanitizeTabs(tabs)
    set((s) => ({
      dockTabsByThreadId: { ...s.dockTabsByThreadId, [threadId]: clean }
    }))
    useEditorStore.getState().restoreTabs(legacyEditorPaths)
  },

  setThreadTabs: (threadId, tabs) =>
    set((s) => ({ dockTabsByThreadId: { ...s.dockTabsByThreadId, [threadId]: tabs } })),

  dropThread: (threadId) =>
    set((s) => {
      const tabs = { ...s.dockTabsByThreadId }
      delete tabs[threadId]
      const indices = { ...s.dockActiveIndexByThreadId }
      delete indices[threadId]
      return { dockTabsByThreadId: tabs, dockActiveIndexByThreadId: indices }
    }),

  resetThreads: () => set({ dockTabsByThreadId: {}, dockActiveIndexByThreadId: {} })
}))

/**
 * Drop dock tabs whose backing resources are gone (missing editor file,
 * deleted named canvas). `stillCurrent` is the caller's workspace fence: once
 * it reports false nothing is written.
 */
export async function validateThreadTabs(
  vault: string,
  threadId: string,
  stillCurrent: () => boolean
): Promise<void> {
  const tabs = useDockStore.getState().dockTabsByThreadId[threadId]
  if (!tabs || tabs.length === 0) return
  // Run filesystem existence checks in parallel; preserve original tab order.
  const checks = await Promise.all(
    tabs.map(async (t) => {
      if (t.kind === 'canvas' && t.id !== 'default') {
        // Named canvases are real per-id stores (3.8); drop tabs whose file is gone.
        return window.api.fs.fileExists(`${vault}/${TE_DIR}/canvas/${t.id}.json`)
      }
      // The kind-keyed surfaces (editor, graph, ghosts, health) reference no
      // per-tab resource — always valid. Missing note files are editor-store's
      // concern, not the dock's.
      return true
    })
  )
  if (!stillCurrent()) return
  const valid = tabs.filter((_, i) => checks[i])
  const dropped = tabs.length - valid.length
  if (dropped > 0) {
    useDockStore.getState().setThreadTabs(threadId, valid)
    console.warn(`[dock-store] dropped ${dropped} dock tab(s) with missing resources`)
  }
}

/**
 * Persist a thread's current dock tabs into its thread file. Exported for the
 * coordinated-quit flush in vault-persist (the active thread's tabs would
 * otherwise be lost — flushing only happens on thread switch).
 */
export async function flushDockState(id: string): Promise<void> {
  const threads = useThreadStore.getState()
  const t = threads.threadsById[id]
  if (!threads.vaultPath || !t) return
  const tabs = useDockStore.getState().dockTabsByThreadId[id] ?? []
  const terminalStrip = useTerminalStripStore.getState().byThreadId[id]
  const next: Thread = { ...t, dockState: { tabs, ...(terminalStrip ? { terminalStrip } : {}) } }
  useThreadStore.setState({ threadsById: { ...threads.threadsById, [id]: next } })
  await window.api.thread.save(threads.vaultPath, next)
}

/**
 * The one way to open a note in the workbench: focus (or open) the singleton
 * editor dock surface, then route note identity into editor-store. Callers
 * must not open editor dock tabs directly — note paths never live in dock
 * state (see dock-types.ts).
 */
export function openNoteInEditor(
  path: string,
  opts?: { readonly preview?: boolean; readonly title?: string }
): void {
  useDockStore.getState().openOrFocusDockTab({ kind: 'editor' })
  const editor = useEditorStore.getState()
  if (opts?.preview) editor.openPreviewTab(path, opts.title)
  else editor.openTab(path, opts?.title)
}

/**
 * The canvas the user is looking at RIGHT NOW: the active thread's active dock
 * tab, when that tab is a canvas — null otherwise. This is the only sanctioned
 * "the canvas" for code outside the canvas tree (dock rails, terminal
 * migration, palette): callers must disable/no-op on null rather than falling
 * back to a last-seen canvas.
 */
export function getFocusedCanvasId(): string | null {
  const threadId = useThreadStore.getState().activeThreadId
  if (!threadId) return null
  const s = useDockStore.getState()
  const tabs = s.dockTabsByThreadId[threadId] ?? []
  const tab = tabs[s.dockActiveIndexByThreadId[threadId] ?? 0]
  return tab?.kind === 'canvas' ? tab.id : null
}

/** Reactive form of {@link getFocusedCanvasId}. */
export function useFocusedCanvasId(): string | null {
  const threadId = useThreadStore((s) => s.activeThreadId)
  return useDockStore((s) => {
    if (!threadId) return null
    const tabs = s.dockTabsByThreadId[threadId] ?? []
    const tab = tabs[s.dockActiveIndexByThreadId[threadId] ?? 0]
    return tab?.kind === 'canvas' ? tab.id : null
  })
}
