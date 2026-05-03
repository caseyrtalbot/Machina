import { create } from 'zustand'
import type { Thread, ThreadMessage, ToolCall, ToolResult } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'
import type { AgentIdentity } from '@shared/agent-identity'
import { TE_DIR } from '@shared/constants'

const MACHINA_NATIVE_SYSTEM_PROMPT =
  'You are Machina, a thoughtful assistant for the user’s vault. Keep replies concise and grounded.'

interface ThreadState {
  vaultPath: string | null
  activeThreadId: string | null
  threadsById: Record<string, Thread>
  archivedThreads: Thread[]
  streamingByThreadId: Record<string, string>
  pendingApprovalsByThreadId: Record<string, ToolCall[]>
  pendingToolCallsByThreadId: Record<string, Array<{ call: ToolCall; result?: ToolResult }>>
  /** Active machina-native runId per thread (cleared on message_end / error). */
  runIdByThreadId: Record<string, string>
  /** True while a turn is in flight for the thread (cleared when it settles). */
  inFlightByThreadId: Record<string, boolean>
  dockTabsByThreadId: Record<string, DockTab[]>
  /** Active dock tab index per thread, restored when re-entering the thread. */
  dockActiveIndexByThreadId: Record<string, number>
  dockCollapsed: boolean
  /** Pixel width of the thread sidebar (left pane). Persisted in vault config. */
  sidebarWidth: number
  /** Pixel width of the surface dock (right pane). Persisted in vault config. */
  dockWidth: number

  setVaultPath: (p: string) => void
  loadThreads: () => Promise<void>
  loadLayout: () => Promise<void>
  setSidebarWidth: (w: number) => void
  setDockWidth: (w: number) => void
  persistLayout: () => Promise<void>
  selectThread: (id: string) => Promise<void>
  createThread: (agent: AgentIdentity, model: string, title?: string) => Promise<Thread>
  archiveThread: (id: string) => Promise<void>
  unarchiveThread: (id: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
  renameThread: (id: string, title: string) => Promise<void>

  appendUserMessage: (text: string) => Promise<void>
  appendAssistantStreamChunk: (threadId: string, chunk: string) => void
  startPendingToolCall: (threadId: string, call: ToolCall) => void
  appendPendingToolCall: (threadId: string, call: ToolCall, result: ToolResult) => void
  finalizeAssistantMessage: (threadId: string) => Promise<void>
  appendCliMessage: (threadId: string, message: ThreadMessage) => Promise<void>
  setRunId: (threadId: string, runId: string | null) => void
  cancelActive: (threadId: string) => Promise<void>
  toggleAutoAccept: (threadId: string) => Promise<void>

  addDockTab: (tab: DockTab) => void
  /** Open the matching tab if one already exists, otherwise add it. Activates either way. */
  openOrFocusDockTab: (tab: DockTab) => void
  removeDockTab: (index: number) => void
  removeDockTabs: (indices: readonly number[]) => void
  reorderDockTab: (from: number, to: number) => void
  setDockActiveIndex: (threadId: string, index: number) => void
  toggleDock: () => void
}

/**
 * Identity used by openOrFocusDockTab to decide whether two tabs are "the same."
 * A null result means "always create a new tab" — used for fresh terminals.
 */
function dockTabIdentity(t: DockTab): string | null {
  switch (t.kind) {
    case 'editor':
      return `editor:${t.path}`
    case 'canvas':
      return `canvas:${t.id}`
    case 'terminal':
      // Each terminal click should spawn a fresh session, even with the same id.
      return null
    case 'graph':
    case 'ghosts':
    case 'health':
      return t.kind
  }
}

const initial = {
  vaultPath: null as string | null,
  activeThreadId: null as string | null,
  threadsById: {} as Record<string, Thread>,
  archivedThreads: [] as Thread[],
  streamingByThreadId: {} as Record<string, string>,
  pendingApprovalsByThreadId: {} as Record<string, ToolCall[]>,
  pendingToolCallsByThreadId: {} as Record<string, Array<{ call: ToolCall; result?: ToolResult }>>,
  runIdByThreadId: {} as Record<string, string>,
  inFlightByThreadId: {} as Record<string, boolean>,
  dockTabsByThreadId: {} as Record<string, DockTab[]>,
  dockActiveIndexByThreadId: {} as Record<string, number>,
  dockCollapsed: false,
  sidebarWidth: 240,
  dockWidth: 480
}

/** Sidebar pixel bounds. Min lets two columns of metadata + pill fit. */
const SIDEBAR_MIN = 200
/** Dock pixel bounds. Min lets the tab strip + a useful panel render. */
const DOCK_MIN = 280
const PANE_MAX_RATIO = 0.7

function clampPaneWidth(w: number, min: number): number {
  const innerWidth = typeof window === 'undefined' ? 1920 : window.innerWidth
  const max = Math.max(min, Math.floor(innerWidth * PANE_MAX_RATIO))
  return Math.max(min, Math.min(max, Math.round(w)))
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  ...initial,

  setVaultPath: (p) => set({ vaultPath: p }),

  loadThreads: async () => {
    const v = get().vaultPath
    if (!v) return
    const list = await window.api.thread.list(v)
    const byId: Record<string, Thread> = {}
    const dockByThread: Record<string, DockTab[]> = {}
    for (const t of list) {
      byId[t.id] = t
      dockByThread[t.id] = t.dockState.tabs.slice()
    }
    set({ threadsById: byId, dockTabsByThreadId: dockByThread })
  },

  loadLayout: async () => {
    const v = get().vaultPath
    if (!v) return
    const cfg = await window.api.thread.readConfig(v)
    set({
      sidebarWidth: clampPaneWidth(cfg.sidebarWidth ?? 240, SIDEBAR_MIN),
      dockWidth: clampPaneWidth(cfg.dockWidth ?? 480, DOCK_MIN),
      dockCollapsed: cfg.dockCollapsed ?? false
    })
  },

  setSidebarWidth: (w) => set({ sidebarWidth: clampPaneWidth(w, SIDEBAR_MIN) }),

  setDockWidth: (w) => set({ dockWidth: clampPaneWidth(w, DOCK_MIN) }),

  persistLayout: async () => {
    const v = get().vaultPath
    if (!v) return
    const cfg = await window.api.thread.readConfig(v)
    await window.api.thread.writeConfig(v, {
      ...cfg,
      sidebarWidth: get().sidebarWidth,
      dockWidth: get().dockWidth,
      dockCollapsed: get().dockCollapsed
    })
  },

  selectThread: async (id) => {
    const prev = get().activeThreadId
    if (prev && prev !== id) await flushDockState(prev)
    const v = get().vaultPath
    const tabs = get().dockTabsByThreadId[id]
    if (v && tabs && tabs.length > 0) {
      const { valid, dropped } = await validateTabs(v, tabs)
      if (dropped > 0) {
        set((s) => ({ dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: valid } }))
        // TODO: replace with toast infra once it exists.
        console.warn(`[thread-store] dropped ${dropped} dock tab(s) with missing resources`)
      }
    }
    set({ activeThreadId: id })
  },

  createThread: async (agent, model, title) => {
    const v = get().vaultPath
    if (!v) throw new Error('vault not set')
    const t = await window.api.thread.create(v, agent, model, title)
    set((s) => ({
      threadsById: { ...s.threadsById, [t.id]: t },
      dockTabsByThreadId: { ...s.dockTabsByThreadId, [t.id]: t.dockState.tabs.slice() },
      activeThreadId: t.id
    }))
    if (agent !== 'machina-native') {
      const result = await window.api.cliThread.spawn({ threadId: t.id, identity: agent, cwd: v })
      if (!result.ok) {
        const sysMsg: ThreadMessage = {
          role: 'system',
          body: result.error,
          sentAt: new Date().toISOString()
        }
        set((s) => {
          const cur = s.threadsById[t.id]
          if (!cur) return s
          const next: Thread = { ...cur, messages: [...cur.messages, sysMsg] }
          return { threadsById: { ...s.threadsById, [t.id]: next } }
        })
        const cur = get().threadsById[t.id]
        if (cur) await window.api.thread.save(v, cur)
      }
    }
    return t
  },

  archiveThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    await window.api.thread.archive(v, id)
    set((s) => {
      const next = { ...s.threadsById }
      delete next[id]
      return {
        threadsById: next,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
  },

  unarchiveThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    await window.api.thread.unarchive(v, id)
    await get().loadThreads()
  },

  deleteThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    const t = get().threadsById[id]
    if (t && t.agent !== 'machina-native') {
      await window.api.cliThread.close(id)
    }
    await window.api.thread.delete(v, id)
    set((s) => {
      const next = { ...s.threadsById }
      delete next[id]
      const stream = { ...s.streamingByThreadId }
      delete stream[id]
      const tools = { ...s.pendingToolCallsByThreadId }
      delete tools[id]
      const dock = { ...s.dockTabsByThreadId }
      delete dock[id]
      const dockIndex = { ...s.dockActiveIndexByThreadId }
      delete dockIndex[id]
      const runs = { ...s.runIdByThreadId }
      delete runs[id]
      const flight = { ...s.inFlightByThreadId }
      delete flight[id]
      return {
        threadsById: next,
        streamingByThreadId: stream,
        pendingToolCallsByThreadId: tools,
        dockTabsByThreadId: dock,
        dockActiveIndexByThreadId: dockIndex,
        runIdByThreadId: runs,
        inFlightByThreadId: flight,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
  },

  renameThread: async (id, title) => {
    const v = get().vaultPath
    if (!v) return
    const trimmed = title.trim()
    if (!trimmed) return
    set((s) => {
      const t = s.threadsById[id]
      if (!t || t.title === trimmed) return s
      const next: Thread = { ...t, title: trimmed }
      return { threadsById: { ...s.threadsById, [id]: next } }
    })
    const t = get().threadsById[id]
    if (t) await window.api.thread.save(v, t)
  },

  appendUserMessage: async (text) => {
    const id = get().activeThreadId
    const v = get().vaultPath
    if (!id || !v) return
    const now = new Date().toISOString()
    set((s) => {
      const t = s.threadsById[id]
      if (!t) return s
      const msg: ThreadMessage = { role: 'user', body: text, sentAt: now }
      const next: Thread = { ...t, messages: [...t.messages, msg], lastMessage: now }
      return { threadsById: { ...s.threadsById, [id]: next } }
    })
    const t = get().threadsById[id]
    if (!t) return
    await window.api.thread.save(v, t)

    set((s) => ({ inFlightByThreadId: { ...s.inFlightByThreadId, [id]: true } }))

    if (t.agent !== 'machina-native') {
      await window.api.cliThread.input({ threadId: id, identity: t.agent, text })
      return
    }
    const history = t.messages
      .slice(0, -1)
      .flatMap((m) =>
        m.role === 'user' || m.role === 'assistant'
          ? [{ role: m.role, content: m.body } as const]
          : []
      )
    const dockTabsSnapshot = get().dockTabsByThreadId[id] ?? []
    const { runId } = await window.api.agentNative.run({
      vaultPath: v,
      threadId: id,
      model: t.model,
      systemPrompt: MACHINA_NATIVE_SYSTEM_PROMPT,
      userMessage: text,
      historyMessages: history,
      autoAccept: t.autoAcceptSession ?? false,
      dockTabsSnapshot
    })
    set((s) => ({ runIdByThreadId: { ...s.runIdByThreadId, [id]: runId } }))
  },

  appendAssistantStreamChunk: (threadId, chunk) =>
    set((s) => ({
      streamingByThreadId: {
        ...s.streamingByThreadId,
        [threadId]: (s.streamingByThreadId[threadId] ?? '') + chunk
      }
    })),

  startPendingToolCall: (threadId, call) =>
    set((s) => {
      const list = s.pendingToolCallsByThreadId[threadId] ?? []
      // Avoid duplicates if a pending event for the same id arrives twice.
      if (list.some((e) => e.call.id === call.id)) return s
      return {
        pendingToolCallsByThreadId: {
          ...s.pendingToolCallsByThreadId,
          [threadId]: [...list, { call }]
        }
      }
    }),

  appendPendingToolCall: (threadId, call, result) =>
    set((s) => {
      const list = s.pendingToolCallsByThreadId[threadId] ?? []
      const existingIdx = list.findIndex((e) => e.call.id === call.id)
      const next =
        existingIdx >= 0
          ? list.map((e, i) => (i === existingIdx ? { call, result } : e))
          : [...list, { call, result }]
      return {
        pendingToolCallsByThreadId: {
          ...s.pendingToolCallsByThreadId,
          [threadId]: next
        }
      }
    }),

  finalizeAssistantMessage: async (threadId) => {
    const v = get().vaultPath
    const buf = get().streamingByThreadId[threadId] ?? ''
    const pendingTools = get().pendingToolCallsByThreadId[threadId] ?? []
    if (!v) return
    set((s) => {
      const t = s.threadsById[threadId]
      if (!t) return s
      const now = new Date().toISOString()
      const msg: ThreadMessage = {
        role: 'assistant',
        body: buf,
        sentAt: now,
        ...(pendingTools.length > 0 ? { toolCalls: pendingTools.slice() } : {})
      }
      const next: Thread = { ...t, messages: [...t.messages, msg], lastMessage: now }
      const stream = { ...s.streamingByThreadId }
      delete stream[threadId]
      const tools = { ...s.pendingToolCallsByThreadId }
      delete tools[threadId]
      const runs = { ...s.runIdByThreadId }
      delete runs[threadId]
      const flight = { ...s.inFlightByThreadId }
      delete flight[threadId]
      return {
        threadsById: { ...s.threadsById, [threadId]: next },
        streamingByThreadId: stream,
        pendingToolCallsByThreadId: tools,
        runIdByThreadId: runs,
        inFlightByThreadId: flight
      }
    })
    const t = get().threadsById[threadId]
    if (t) await window.api.thread.save(v, t)
  },

  appendCliMessage: async (threadId, message) => {
    const v = get().vaultPath
    if (!v) return
    set((s) => {
      const t = s.threadsById[threadId]
      if (!t) return s
      const next: Thread = {
        ...t,
        messages: [...t.messages, message],
        lastMessage: message.sentAt
      }
      const flight = { ...s.inFlightByThreadId }
      delete flight[threadId]
      return { threadsById: { ...s.threadsById, [threadId]: next }, inFlightByThreadId: flight }
    })
    const t = get().threadsById[threadId]
    if (t) await window.api.thread.save(v, t)
  },

  setRunId: (threadId, runId) =>
    set((s) => {
      const next = { ...s.runIdByThreadId }
      if (runId === null) delete next[threadId]
      else next[threadId] = runId
      return { runIdByThreadId: next }
    }),

  cancelActive: async (threadId) => {
    const t = get().threadsById[threadId]
    if (!t) return
    if (t.agent === 'machina-native') {
      const runId = get().runIdByThreadId[threadId]
      if (runId) await window.api.agentNative.abort(runId)
    } else {
      await window.api.cliThread.cancel(threadId)
    }
    set((s) => {
      const flight = { ...s.inFlightByThreadId }
      delete flight[threadId]
      return { inFlightByThreadId: flight }
    })
  },

  toggleAutoAccept: async (threadId) => {
    const v = get().vaultPath
    if (!v) return
    set((s) => {
      const t = s.threadsById[threadId]
      if (!t) return s
      const next: Thread = { ...t, autoAcceptSession: !(t.autoAcceptSession ?? false) }
      return { threadsById: { ...s.threadsById, [threadId]: next } }
    })
    const t = get().threadsById[threadId]
    if (t) await window.api.thread.save(v, t)
  },

  addDockTab: (tab) => {
    const id = get().activeThreadId
    if (!id) return
    set((s) => {
      const next = [...(s.dockTabsByThreadId[id] ?? []), tab]
      return {
        dockCollapsed: false,
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: next },
        dockActiveIndexByThreadId: {
          ...s.dockActiveIndexByThreadId,
          [id]: next.length - 1
        }
      }
    })
  },

  openOrFocusDockTab: (tab) => {
    const id = get().activeThreadId
    if (!id) return
    set((s) => {
      const tabs = s.dockTabsByThreadId[id] ?? []
      const identity = dockTabIdentity(tab)
      const existingIdx =
        identity === null ? -1 : tabs.findIndex((t) => dockTabIdentity(t) === identity)
      if (existingIdx >= 0) {
        return {
          dockCollapsed: false,
          dockActiveIndexByThreadId: {
            ...s.dockActiveIndexByThreadId,
            [id]: existingIdx
          }
        }
      }
      const next = [...tabs, tab]
      return {
        dockCollapsed: false,
        dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: next },
        dockActiveIndexByThreadId: {
          ...s.dockActiveIndexByThreadId,
          [id]: next.length - 1
        }
      }
    })
  },

  removeDockTab: (index) => {
    const id = get().activeThreadId
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
        dockActiveIndexByThreadId: {
          ...s.dockActiveIndexByThreadId,
          [id]: nextActive
        }
      }
    })
  },

  removeDockTabs: (indices) => {
    if (indices.length === 0) return
    const id = get().activeThreadId
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
        dockActiveIndexByThreadId: {
          ...s.dockActiveIndexByThreadId,
          [id]: nextActive
        }
      }
    })
  },

  reorderDockTab: (from, to) => {
    const id = get().activeThreadId
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
    set((s) => ({ dockCollapsed: !s.dockCollapsed }))
    // Fire-and-forget: persist the new collapsed state so it survives restart.
    void get().persistLayout()
  }
}))

async function validateTabs(
  vault: string,
  tabs: readonly DockTab[]
): Promise<{ valid: DockTab[]; dropped: number }> {
  // Run filesystem existence checks in parallel; preserve original tab order.
  const checks = await Promise.all(
    tabs.map(async (t) => {
      if (t.kind === 'editor' && t.path !== '') {
        return window.api.fs.fileExists(t.path)
      }
      if (t.kind === 'canvas' && t.id !== 'default') {
        // Per-id canvas files are not yet implemented; only the global "default" is real.
        return window.api.fs.fileExists(`${vault}/${TE_DIR}/canvas/${t.id}.json`)
      }
      // terminal and the static kinds (graph, ghosts, health) are always valid in v1
      return true
    })
  )
  const valid: DockTab[] = []
  let dropped = 0
  for (let i = 0; i < tabs.length; i += 1) {
    if (checks[i]) valid.push(tabs[i])
    else dropped += 1
  }
  return { valid, dropped }
}

async function flushDockState(id: string): Promise<void> {
  const s = useThreadStore.getState()
  const t = s.threadsById[id]
  if (!s.vaultPath || !t) return
  const tabs = s.dockTabsByThreadId[id] ?? []
  const next: Thread = { ...t, dockState: { tabs } }
  useThreadStore.setState({ threadsById: { ...s.threadsById, [id]: next } })
  await window.api.thread.save(s.vaultPath, next)
}
