import { create } from 'zustand'
import type {
  AssistantMessage,
  Thread,
  ThreadMessage,
  ToolCall,
  ToolResult
} from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'
import type { AgentIdentity } from '@shared/agent-identity'
import { TE_DIR } from '@shared/constants'
import { setActiveCanvas } from './canvas-store'
import { useTerminalStripStore } from './terminal-strip-store'
import { useCliSessionStore } from './cli-session-store'
import { transportFor, type DispatchStatus, type SendTurnResult } from './agent-transport'
import {
  captureWorkspaceDispatch,
  threadRuntimeIsClosed,
  threadStartIsBlocked,
  useAgentDispatchStore,
  workspaceDispatchIsCurrent
} from './agent-dispatch-store'
import { withTimeout } from '../utils/ipc-timeout'
import { notifyError } from '../utils/error-logger'
import {
  persistFilesPanelOpen,
  readPersistedFilesPanelOpen
} from '../panels/agent-shell/files-side-panel-storage'

interface ThreadState {
  vaultPath: string | null
  activeThreadId: string | null
  threadsById: Record<string, Thread>
  archivedThreads: Thread[]
  streamingByThreadId: Record<string, string>
  pendingApprovalsByThreadId: Record<string, ToolCall[]>
  pendingToolCallsByThreadId: Record<string, Array<{ call: ToolCall; result?: ToolResult }>>
  runIdByThreadId: Record<string, string>
  inFlightByThreadId: Record<string, boolean>
  dockTabsByThreadId: Record<string, DockTab[]>
  dockActiveIndexByThreadId: Record<string, number>
  dockCollapsed: boolean
  sidebarWidth: number
  chatWidth: number
  sidebarCollapsed: boolean
  chatCollapsed: boolean
  filesPanelOpen: boolean
  focusMode: boolean
  focusSnapshot: {
    sidebarCollapsed: boolean
    chatCollapsed: boolean
    filesPanelOpen: boolean
    dockCollapsed: boolean
  } | null

  setVaultPath: (p: string) => void
  loadThreads: () => Promise<void>
  loadLayout: () => Promise<void>
  setSidebarWidth: (w: number) => void
  setChatWidth: (w: number) => void
  toggleSidebarCollapsed: () => void
  toggleChatCollapsed: () => void
  toggleFilesPanel: () => void
  closeFilesPanel: () => void
  toggleFocusMode: () => void
  persistLayout: () => Promise<void>
  selectThread: (id: string, opts?: { reveal?: boolean }) => Promise<void>
  createThread: (
    agent: AgentIdentity,
    model: string,
    title?: string,
    agentId?: string
  ) => Promise<Thread>
  archiveThread: (id: string) => Promise<void>
  unarchiveThread: (id: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
  loadArchivedThreads: () => Promise<void>
  deleteArchivedThread: (id: string) => Promise<void>
  renameThread: (id: string, title: string) => Promise<void>
  setThreadModel: (id: string, model: string) => Promise<void>
  setThreadAgentId: (id: string, agentId: string) => Promise<void>
  appendUserMessage: (text: string, targetThreadId?: string) => Promise<DispatchStatus>
  appendAssistantStreamChunk: (threadId: string, runId: string, chunk: string) => void
  startPendingToolCall: (threadId: string, call: ToolCall) => void
  appendPendingToolCall: (threadId: string, call: ToolCall, result: ToolResult) => void
  finalizeAssistantMessage: (threadId: string) => Promise<void>
  appendCliMessage: (threadId: string, message: ThreadMessage) => Promise<void>
  setRunId: (threadId: string, runId: string | null) => void
  cancelActive: (threadId: string) => Promise<void>
  toggleAutoAccept: (threadId: string) => void

  addDockTab: (tab: DockTab) => void
  openOrFocusDockTab: (tab: DockTab) => void
  removeDockTab: (index: number) => void
  removeDockTabs: (indices: readonly number[]) => void
  reorderDockTab: (from: number, to: number) => void
  setDockActiveIndex: (threadId: string, index: number) => void
  toggleDock: () => void
}

function dockTabIdentity(t: DockTab): string | null {
  switch (t.kind) {
    case 'editor':
      return `editor:${t.path}`
    case 'canvas':
      return `canvas:${t.id}`
    case 'terminal':
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
  chatWidth: 420,
  sidebarCollapsed: false,
  chatCollapsed: false,
  filesPanelOpen: readPersistedFilesPanelOpen(),
  focusMode: false,
  focusSnapshot: null as ThreadState['focusSnapshot']
}

const SIDEBAR_MIN = 160
const CHAT_MIN = 320
const PANE_MAX_RATIO = 0.85
const THREAD_IPC_TIMEOUT_MS = 15_000

function saveThread(vaultPath: string, thread: Thread, label: string): Promise<void> {
  return withTimeout(window.api.thread.save(vaultPath, thread), THREAD_IPC_TIMEOUT_MS, label)
}

function addSystemMessage(thread: Thread, body: string): Thread {
  return {
    ...thread,
    messages: [...thread.messages, { role: 'system', body, sentAt: new Date().toISOString() }]
  }
}

function clearThreadInFlight(threadId: string): void {
  useThreadStore.setState((state) => {
    const inFlight = { ...state.inFlightByThreadId }
    delete inFlight[threadId]
    return { inFlightByThreadId: inFlight }
  })
}

async function requestTransportCancel(thread: Thread, runId: string | undefined): Promise<void> {
  try {
    await transportFor(thread.agent).cancel(thread, runId)
  } catch (error) {
    notifyError(
      'thread-stop',
      error,
      'Stop request failed. The run may still be active; sending remains blocked until it settles.'
    )
  }
}

function watchDispatchSettlement(
  result: Extract<SendTurnResult, { status: 'indeterminate' }>,
  thread: Thread,
  workspace: ReturnType<typeof captureWorkspaceDispatch>
): void {
  void result.settlement.then((late) => {
    const closed = threadRuntimeIsClosed(thread.id) || !workspaceDispatchIsCurrent(workspace)
    if (late.status === 'accepted') {
      if (late.runId !== undefined && !closed)
        useThreadStore.setState((state) => ({
          runIdByThreadId: { ...state.runIdByThreadId, [thread.id]: late.runId as string }
        }))
      if (closed || useAgentDispatchStore.getState().cancelRequestedByThreadId[thread.id])
        void requestTransportCancel(thread, late.runId)
      return
    }
    if (late.status === 'refused' && !closed) {
      clearThreadInFlight(thread.id)
      useAgentDispatchStore.getState().clearCancelRequest(thread.id)
    }
  })
}

async function dispatchPersistedTurn(
  previousThread: Thread,
  nextThread: Thread,
  text: string,
  workspace: ReturnType<typeof captureWorkspaceDispatch>
): Promise<DispatchStatus> {
  const id = nextThread.id
  if (!workspaceDispatchIsCurrent(workspace) || threadRuntimeIsClosed(id)) return 'indeterminate'
  const state = useThreadStore.getState()
  const result = await transportFor(nextThread.agent).sendTurn(nextThread, text, {
    vaultPath: workspace.workspacePath,
    historyMessages: buildNativeHistory(previousThread.messages),
    dockTabsSnapshot: state.dockTabsByThreadId[id] ?? []
  })

  if (result.status === 'accepted') {
    const closed = threadRuntimeIsClosed(id) || !workspaceDispatchIsCurrent(workspace)
    if (result.runId !== undefined && !closed)
      useThreadStore.setState((current) => ({
        runIdByThreadId: { ...current.runIdByThreadId, [id]: result.runId as string }
      }))
    if (closed) void requestTransportCancel(nextThread, result.runId)
    return closed ? 'indeterminate' : 'accepted'
  }

  if (result.status === 'indeterminate') watchDispatchSettlement(result, nextThread, workspace)
  else clearThreadInFlight(id)

  const current = useThreadStore.getState().threadsById[id]
  if (current && workspaceDispatchIsCurrent(workspace) && !threadRuntimeIsClosed(id)) {
    const withStatus = addSystemMessage(current, result.message)
    useThreadStore.setState((latest) => ({
      threadsById: { ...latest.threadsById, [id]: withStatus }
    }))
    const statusPersistence = window.api.thread.save(workspace.workspacePath, withStatus)
    try {
      await withTimeout(
        statusPersistence,
        THREAD_IPC_TIMEOUT_MS,
        `thread:save dispatch status ${id}`
      )
    } catch {
      void statusPersistence.catch(() => {})
      return 'indeterminate'
    }
  }
  return result.status
}

function clampPaneWidth(w: number, min: number): number {
  const innerWidth = typeof window === 'undefined' ? 1920 : window.innerWidth
  const max = Math.max(min, Math.floor(innerWidth * PANE_MAX_RATIO))
  return Math.max(min, Math.min(max, Math.round(w)))
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  ...initial,

  setVaultPath: (p) => {
    const current = get().vaultPath
    if (current === p) {
      captureWorkspaceDispatch(p)
      return
    }
    const oldThreads = Object.values(get().threadsById)
    const dispatch = useAgentDispatchStore.getState()
    for (const thread of oldThreads) {
      dispatch.dropThreadRuntime(thread.id)
    }
    useCliSessionStore.getState().reset()
    dispatch.switchWorkspace(
      p,
      oldThreads.map((thread) => thread.id)
    )
    set({
      vaultPath: p,
      activeThreadId: null,
      threadsById: {},
      archivedThreads: [],
      streamingByThreadId: {},
      pendingApprovalsByThreadId: {},
      pendingToolCallsByThreadId: {},
      runIdByThreadId: {},
      inFlightByThreadId: {},
      dockTabsByThreadId: {},
      dockActiveIndexByThreadId: {}
    })
  },

  loadThreads: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const list = await window.api.thread.list(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    const byId: Record<string, Thread> = {}
    const dockByThread: Record<string, DockTab[]> = {}
    const dispatch = useAgentDispatchStore.getState()
    for (const t of list) {
      dispatch.setThreadStart(t.id, 'ready')
      byId[t.id] = t
      dockByThread[t.id] = t.dockState.tabs.slice()
      useTerminalStripStore.getState().seed(t.id, t.dockState.terminalStrip)
    }
    set({ threadsById: byId, dockTabsByThreadId: dockByThread })
  },

  loadLayout: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const cfg = await window.api.thread.readConfig(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    const chatCollapsed = cfg.chatCollapsed ?? false
    const dockCollapsed = (cfg.dockCollapsed ?? false) && !chatCollapsed
    set({
      sidebarWidth: clampPaneWidth(cfg.sidebarWidth ?? 240, SIDEBAR_MIN),
      chatWidth: clampPaneWidth(cfg.chatWidth ?? 420, CHAT_MIN),
      sidebarCollapsed: cfg.sidebarCollapsed ?? false,
      chatCollapsed,
      dockCollapsed
    })
  },

  setSidebarWidth: (w) => set({ sidebarWidth: clampPaneWidth(w, SIDEBAR_MIN) }),

  setChatWidth: (w) => set({ chatWidth: clampPaneWidth(w, CHAT_MIN) }),

  toggleSidebarCollapsed: () => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed, focusMode: false, focusSnapshot: null }))
    void get().persistLayout()
  },

  toggleChatCollapsed: () => {
    set((s) => ({
      chatCollapsed: !s.chatCollapsed,
      dockCollapsed: !s.chatCollapsed ? false : s.dockCollapsed,
      focusMode: false,
      focusSnapshot: null
    }))
    void get().persistLayout()
  },

  toggleFilesPanel: () => {
    const next = !get().filesPanelOpen
    persistFilesPanelOpen(next)
    set({ filesPanelOpen: next, focusMode: false, focusSnapshot: null })
  },

  closeFilesPanel: () => {
    if (!get().filesPanelOpen) return
    persistFilesPanelOpen(false)
    set({ filesPanelOpen: false })
  },

  toggleFocusMode: () => {
    const s = get()
    if (s.focusMode && s.focusSnapshot) {
      set({ ...s.focusSnapshot, focusMode: false, focusSnapshot: null })
      return
    }
    set({
      focusMode: true,
      focusSnapshot: {
        sidebarCollapsed: s.sidebarCollapsed,
        chatCollapsed: s.chatCollapsed,
        filesPanelOpen: s.filesPanelOpen,
        dockCollapsed: s.dockCollapsed
      },
      sidebarCollapsed: true,
      chatCollapsed: true,
      filesPanelOpen: false,
      dockCollapsed: false
    })
  },

  persistLayout: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const layout = get()
    const cfg = await window.api.thread.readConfig(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    await window.api.thread.writeConfig(v, {
      ...cfg,
      sidebarWidth: layout.sidebarWidth,
      chatWidth: layout.chatWidth,
      sidebarCollapsed: layout.sidebarCollapsed,
      chatCollapsed: layout.chatCollapsed,
      dockCollapsed: layout.dockCollapsed
    })
  },

  selectThread: async (id, opts) => {
    const prev = get().activeThreadId
    const v = get().vaultPath
    const workspace = v ? captureWorkspaceDispatch(v) : null
    if (prev && prev !== id) await flushDockState(prev)
    if (workspace && !workspaceDispatchIsCurrent(workspace)) return
    const tabs = get().dockTabsByThreadId[id]
    if (v && tabs && tabs.length > 0) {
      const { valid, dropped } = await validateTabs(v, tabs)
      if (workspace && !workspaceDispatchIsCurrent(workspace)) return
      if (dropped > 0) {
        set((s) => ({ dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: valid } }))
        console.warn(`[thread-store] dropped ${dropped} dock tab(s) with missing resources`)
      }
    }
    const reveal = opts?.reveal ?? true
    set((s) =>
      reveal && s.chatCollapsed
        ? { activeThreadId: id, chatCollapsed: false, focusMode: false, focusSnapshot: null }
        : { activeThreadId: id }
    )
  },

  createThread: async (agent, model, title, agentId) => {
    const v = get().vaultPath
    if (!v) throw new Error('vault not set')
    const workspace = captureWorkspaceDispatch(v)
    const created = await withTimeout(
      window.api.thread.create(v, agent, model, title),
      THREAD_IPC_TIMEOUT_MS,
      'thread:create'
    )
    if (!workspaceDispatchIsCurrent(workspace)) {
      void window.api.thread.delete(v, created.id).catch(() => {})
      throw new Error('workspace changed while creating thread')
    }
    const t: Thread = agentId !== undefined ? { ...created, agentId } : created
    if (agentId !== undefined) await saveThread(v, t, `thread:save ${t.id}`)
    if (!workspaceDispatchIsCurrent(workspace)) {
      void window.api.thread.delete(v, t.id).catch(() => {})
      throw new Error('workspace changed while creating thread')
    }
    useAgentDispatchStore.getState().setThreadStart(t.id, 'starting')
    set((s) => ({
      threadsById: { ...s.threadsById, [t.id]: t },
      dockTabsByThreadId: { ...s.dockTabsByThreadId, [t.id]: t.dockState.tabs.slice() },
      activeThreadId: t.id,
      chatCollapsed: false,
      focusMode: false,
      focusSnapshot: null
    }))
    const started = await transportFor(agent).start(t, v)
    if (!workspaceDispatchIsCurrent(workspace) || threadRuntimeIsClosed(t.id)) {
      useAgentDispatchStore.getState().dropThreadRuntime(t.id)
      void transportFor(agent)
        .close(t.id)
        .catch(() => {})
      throw new Error('workspace changed while starting thread')
    }
    const dispatch = useAgentDispatchStore.getState()
    dispatch.setThreadStart(t.id, started.status === 'indeterminate' ? 'indeterminate' : 'ready')
    if (started.status === 'indeterminate')
      void started.settlement.then((late) => {
        if (late.status !== 'indeterminate' && !threadRuntimeIsClosed(t.id))
          useAgentDispatchStore.getState().setThreadStart(t.id, 'ready')
      })
    if (started.status !== 'accepted') {
      set((s) => {
        const cur = s.threadsById[t.id]
        if (!cur) return s
        const next = addSystemMessage(cur, started.message)
        return { threadsById: { ...s.threadsById, [t.id]: next } }
      })
      const cur = get().threadsById[t.id]
      if (cur) await saveThread(v, cur, `thread:save start status ${t.id}`)
    }
    return t
  },

  archiveThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    await window.api.thread.archive(v, id)
    if (!workspaceDispatchIsCurrent(workspace)) return
    set((s) => {
      const next = { ...s.threadsById }
      const archived = next[id]
      delete next[id]
      return {
        threadsById: next,
        archivedThreads: archived ? [archived, ...s.archivedThreads] : s.archivedThreads,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
  },

  unarchiveThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    await window.api.thread.unarchive(v, id)
    if (!workspaceDispatchIsCurrent(workspace)) return
    set((s) => ({ archivedThreads: s.archivedThreads.filter((t) => t.id !== id) }))
    await get().loadThreads()
  },

  loadArchivedThreads: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const list = await window.api.thread.listArchived(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    set({ archivedThreads: list })
  },

  deleteArchivedThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    await window.api.thread.unarchive(v, id)
    await window.api.thread.delete(v, id)
    if (!workspaceDispatchIsCurrent(workspace)) return
    set((s) => ({ archivedThreads: s.archivedThreads.filter((t) => t.id !== id) }))
  },

  deleteThread: async (id) => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const t = get().threadsById[id]
    useAgentDispatchStore.getState().dropThreadRuntime(id)
    if (t)
      await withTimeout(
        transportFor(t.agent).close(id),
        THREAD_IPC_TIMEOUT_MS,
        `thread:close ${id}`
      )
    await withTimeout(window.api.thread.delete(v, id), THREAD_IPC_TIMEOUT_MS, `thread:delete ${id}`)
    if (!workspaceDispatchIsCurrent(workspace)) return
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
    useTerminalStripStore.getState().drop(id)
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

  setThreadModel: async (id, model) => {
    const v = get().vaultPath
    if (!v) return
    const t = get().threadsById[id]
    if (!t || t.model === model) return
    const next: Thread = { ...t, model }
    set((s) => ({ threadsById: { ...s.threadsById, [id]: next } }))
    await window.api.thread.save(v, next)
  },

  setThreadAgentId: async (id, agentId) => {
    const v = get().vaultPath
    if (!v) return
    const t = get().threadsById[id]
    if (!t || t.agentId === agentId) return
    const next: Thread = { ...t, agentId }
    set((s) => ({ threadsById: { ...s.threadsById, [id]: next } }))
    await saveThread(v, next, `thread:save agent ${id}`)
  },

  appendUserMessage: async (text, targetThreadId) => {
    const id = targetThreadId ?? get().activeThreadId
    const v = get().vaultPath
    if (!id || !v) return 'refused'
    const workspace = captureWorkspaceDispatch(v)
    const t = get().threadsById[id]
    if (!t) return 'refused'
    const dispatch = useAgentDispatchStore.getState()
    if (get().inFlightByThreadId[id] || threadStartIsBlocked(dispatch.threadStartById[id]))
      return 'indeterminate'
    const now = new Date().toISOString()
    const msg: ThreadMessage = { role: 'user', body: text, sentAt: now }
    const nextThread: Thread = { ...t, messages: [...t.messages, msg], lastMessage: now }
    set((s) => ({ threadsById: { ...s.threadsById, [id]: nextThread } }))
    dispatch.beginTurn(id)
    set((s) => ({ inFlightByThreadId: { ...s.inFlightByThreadId, [id]: true } }))

    const persistence = window.api.thread.save(v, nextThread)
    try {
      await withTimeout(persistence, THREAD_IPC_TIMEOUT_MS, `thread:save user message ${id}`)
    } catch {
      const current = get().threadsById[id]
      if (current)
        set((s) => ({
          threadsById: {
            ...s.threadsById,
            [id]: addSystemMessage(
              current,
              'Message persistence status is unknown. It was not dispatched, but the save may still complete; do not retry until you inspect this thread.'
            )
          }
        }))
      void persistence.then(
        () => {
          const dispatchState = useAgentDispatchStore.getState()
          if (
            workspaceDispatchIsCurrent(workspace) &&
            !threadRuntimeIsClosed(id) &&
            !dispatchState.cancelRequestedByThreadId[id]
          ) {
            void dispatchPersistedTurn(t, nextThread, text, workspace).catch(() => {
              clearThreadInFlight(id)
            })
          } else if (workspaceDispatchIsCurrent(workspace) && !threadRuntimeIsClosed(id)) {
            clearThreadInFlight(id)
            dispatchState.clearCancelRequest(id)
          }
        },
        () => {
          if (workspaceDispatchIsCurrent(workspace) && !threadRuntimeIsClosed(id)) {
            clearThreadInFlight(id)
            useAgentDispatchStore.getState().clearCancelRequest(id)
          }
        }
      )
      return 'indeterminate'
    }

    return dispatchPersistedTurn(t, nextThread, text, workspace)
  },

  appendAssistantStreamChunk: (threadId, runId, chunk) =>
    set((s) => {
      // Drop chunks whose runId doesn't match the thread's active run —
      // events from an aborted or already-finalized run must not bleed
      // into the next turn's streaming buffer.
      if (s.runIdByThreadId[threadId] !== runId) return s
      return {
        streamingByThreadId: {
          ...s.streamingByThreadId,
          [threadId]: (s.streamingByThreadId[threadId] ?? '') + chunk
        }
      }
    }),

  startPendingToolCall: (threadId, call) =>
    set((s) => {
      const list = s.pendingToolCallsByThreadId[threadId] ?? []
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
    useAgentDispatchStore.getState().settleThread(threadId)
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
    useAgentDispatchStore.getState().settleThread(threadId)
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
    useAgentDispatchStore.getState().requestCancel(threadId)
    await requestTransportCancel(t, get().runIdByThreadId[threadId])
    // Abort/Ctrl-C acknowledges a signal, not settlement. A timed-out invoke
    // may still accept input later, so only the main-originated completion or
    // error paths may clear inFlight and reopen sending.
  },

  toggleAutoAccept: (threadId) => {
    set((s) => {
      const t = s.threadsById[threadId]
      if (!t) return s
      const next: Thread = { ...t, autoAcceptSession: !(t.autoAcceptSession ?? false) }
      return { threadsById: { ...s.threadsById, [threadId]: next } }
    })
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
    set((s) => ({
      dockCollapsed: !s.dockCollapsed,
      // Mirror of toggleChatCollapsed: never leave both panes collapsed.
      chatCollapsed: !s.dockCollapsed ? false : s.chatCollapsed,
      focusMode: false,
      focusSnapshot: null
    }))
    void get().persistLayout()
  }
}))

// Active-canvas indirection (3.8): whenever the active dock tab is a canvas,
// point the global `useCanvasStore` proxy at that canvas's store instance.
// Non-canvas tabs keep the last canvas active so palette/sidebar actions that
// target "the canvas" keep meaning the one the user last looked at.
useThreadStore.subscribe((s) => {
  const threadId = s.activeThreadId
  if (!threadId) return
  const tabs = s.dockTabsByThreadId[threadId] ?? []
  const tab = tabs[s.dockActiveIndexByThreadId[threadId] ?? 0]
  if (tab?.kind === 'canvas') setActiveCanvas(tab.id)
})

/** Truncate a serialized payload so history summaries stay token-bounded. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * Compact textual record of an assistant turn's tool exchanges, appended to
 * the message body in native history. Reconstructing real tool_use/tool_result
 * blocks would require a structured history IPC shape; the summary keeps
 * multi-turn tool context (which note was read, what a search returned) from
 * vanishing between turns without it.
 */
function summarizeToolCalls(toolCalls: NonNullable<AssistantMessage['toolCalls']>): string {
  return toolCalls
    .map((tc) => {
      const args = clip(JSON.stringify(tc.call.args), 200)
      const outcome = !tc.result
        ? 'no result'
        : tc.result.ok
          ? `ok: ${clip(JSON.stringify(tc.result.output), 400)}`
          : `error ${tc.result.error.code}: ${clip(tc.result.error.message, 200)}`
      return `[tool ${tc.call.kind} ${args} → ${outcome}]`
    })
    .join('\n')
}

/**
 * Build the native run's history. Tool-only turns persist body: '' — the
 * Anthropic API rejects empty content, so they're either represented by their
 * tool-exchange summary or dropped entirely.
 */
function buildNativeHistory(
  messages: readonly ThreadMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const body = m.body.trim()
    const summary =
      m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
        ? summarizeToolCalls(m.toolCalls)
        : ''
    const content = [body, summary].filter((part) => part.length > 0).join('\n\n')
    if (content.length === 0) continue
    history.push({ role: m.role, content })
  }
  return history
}

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
        // Named canvases are real per-id stores (3.8); drop tabs whose file is gone.
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

/**
 * Persist a thread's current dock tabs into its thread file. Exported for the
 * coordinated-quit flush in vault-persist (the active thread's tabs would
 * otherwise be lost — flushing only happens on thread switch).
 */
export async function flushDockState(id: string): Promise<void> {
  const s = useThreadStore.getState()
  const t = s.threadsById[id]
  if (!s.vaultPath || !t) return
  const tabs = s.dockTabsByThreadId[id] ?? []
  const terminalStrip = useTerminalStripStore.getState().byThreadId[id]
  const next: Thread = { ...t, dockState: { tabs, ...(terminalStrip ? { terminalStrip } : {}) } }
  useThreadStore.setState({ threadsById: { ...s.threadsById, [id]: next } })
  await window.api.thread.save(s.vaultPath, next)
}
