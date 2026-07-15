import { create } from 'zustand'
import type {
  AssistantMessage,
  Thread,
  ThreadMessage,
  ToolCall,
  ToolResult
} from '@shared/thread-types'
import type { AgentIdentity } from '@shared/agent-identity'
import { useTerminalStripStore } from './terminal-strip-store'
import { flushDockState, syncActiveCanvas, useDockStore, validateThreadTabs } from './dock-store'
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
  const result = await transportFor(nextThread.agent).sendTurn(nextThread, text, {
    vaultPath: workspace.workspacePath,
    historyMessages: buildNativeHistory(previousThread.messages),
    dockTabsSnapshot: useDockStore.getState().dockTabsByThreadId[id] ?? []
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
      inFlightByThreadId: {}
    })
    useDockStore.getState().resetThreads()
  },

  loadThreads: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const list = await window.api.thread.list(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    const byId: Record<string, Thread> = {}
    const dispatch = useAgentDispatchStore.getState()
    for (const t of list) {
      dispatch.setThreadStart(t.id, 'ready')
      byId[t.id] = t
      useTerminalStripStore.getState().seed(t.id, t.dockState.terminalStrip)
    }
    useDockStore.getState().seedFromThreads(list)
    set({ threadsById: byId })
  },

  loadLayout: async () => {
    const v = get().vaultPath
    if (!v) return
    const workspace = captureWorkspaceDispatch(v)
    const cfg = await window.api.thread.readConfig(v)
    if (!workspaceDispatchIsCurrent(workspace)) return
    const chatCollapsed = cfg.chatCollapsed ?? false
    useDockStore.getState().setDockCollapsed((cfg.dockCollapsed ?? false) && !chatCollapsed)
    set({
      sidebarWidth: clampPaneWidth(cfg.sidebarWidth ?? 240, SIDEBAR_MIN),
      chatWidth: clampPaneWidth(cfg.chatWidth ?? 420, CHAT_MIN),
      sidebarCollapsed: cfg.sidebarCollapsed ?? false,
      chatCollapsed
    })
  },

  setSidebarWidth: (w) => set({ sidebarWidth: clampPaneWidth(w, SIDEBAR_MIN) }),

  setChatWidth: (w) => set({ chatWidth: clampPaneWidth(w, CHAT_MIN) }),

  toggleSidebarCollapsed: () => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed, focusMode: false, focusSnapshot: null }))
    void get().persistLayout()
  },

  toggleChatCollapsed: () => {
    const collapsing = !get().chatCollapsed
    // Mirror of toggleDock: never leave both panes collapsed.
    if (collapsing) useDockStore.getState().setDockCollapsed(false)
    set({ chatCollapsed: collapsing, focusMode: false, focusSnapshot: null })
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
      const { dockCollapsed, ...paneSnapshot } = s.focusSnapshot
      useDockStore.getState().setDockCollapsed(dockCollapsed)
      set({ ...paneSnapshot, focusMode: false, focusSnapshot: null })
      return
    }
    set({
      focusMode: true,
      focusSnapshot: {
        sidebarCollapsed: s.sidebarCollapsed,
        chatCollapsed: s.chatCollapsed,
        filesPanelOpen: s.filesPanelOpen,
        dockCollapsed: useDockStore.getState().dockCollapsed
      },
      sidebarCollapsed: true,
      chatCollapsed: true,
      filesPanelOpen: false
    })
    useDockStore.getState().setDockCollapsed(false)
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
      dockCollapsed: useDockStore.getState().dockCollapsed
    })
  },

  selectThread: async (id, opts) => {
    const prev = get().activeThreadId
    const v = get().vaultPath
    const workspace = v ? captureWorkspaceDispatch(v) : null
    if (prev && prev !== id) await flushDockState(prev)
    if (workspace && !workspaceDispatchIsCurrent(workspace)) return
    const stillCurrent = () => !workspace || workspaceDispatchIsCurrent(workspace)
    if (v) await validateThreadTabs(v, id, stillCurrent)
    if (!stillCurrent()) return
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
    useDockStore.getState().seedThreadTabs(t.id, t.dockState.tabs)
    set((s) => ({
      threadsById: { ...s.threadsById, [t.id]: t },
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
      const runs = { ...s.runIdByThreadId }
      delete runs[id]
      const flight = { ...s.inFlightByThreadId }
      delete flight[id]
      return {
        threadsById: next,
        streamingByThreadId: stream,
        pendingToolCallsByThreadId: tools,
        runIdByThreadId: runs,
        inFlightByThreadId: flight,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
    useDockStore.getState().dropThread(id)
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
  }
}))

// The active-canvas indirection also depends on activeThreadId, so the shared
// sync (declared in dock-store, which owns the tab state) is registered on
// this store too. Own-store subscribe only — cycle-safe, see dock-store header.
useThreadStore.subscribe(syncActiveCanvas)

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
