import { create } from 'zustand'
import type { Thread, ThreadMessage, ToolCall } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'
import type { AgentIdentity } from '@shared/agent-identity'

const MACHINA_NATIVE_SYSTEM_PROMPT =
  'You are Machina, a thoughtful assistant for the user’s vault. Keep replies concise and grounded.'

interface ThreadState {
  vaultPath: string | null
  activeThreadId: string | null
  threadsById: Record<string, Thread>
  archivedThreads: Thread[]
  streamingByThreadId: Record<string, string>
  pendingApprovalsByThreadId: Record<string, ToolCall[]>
  dockTabsByThreadId: Record<string, DockTab[]>

  setVaultPath: (p: string) => void
  loadThreads: () => Promise<void>
  selectThread: (id: string) => Promise<void>
  createThread: (agent: AgentIdentity, model: string, title?: string) => Promise<Thread>
  archiveThread: (id: string) => Promise<void>
  unarchiveThread: (id: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>

  appendUserMessage: (text: string) => Promise<void>
  appendAssistantStreamChunk: (threadId: string, chunk: string) => void
  finalizeAssistantMessage: (threadId: string) => Promise<void>

  addDockTab: (tab: DockTab) => void
  removeDockTab: (index: number) => void
  reorderDockTab: (from: number, to: number) => void
}

const initial = {
  vaultPath: null as string | null,
  activeThreadId: null as string | null,
  threadsById: {} as Record<string, Thread>,
  archivedThreads: [] as Thread[],
  streamingByThreadId: {} as Record<string, string>,
  pendingApprovalsByThreadId: {} as Record<string, ToolCall[]>,
  dockTabsByThreadId: {} as Record<string, DockTab[]>
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

  selectThread: async (id) => {
    const prev = get().activeThreadId
    if (prev && prev !== id) await flushDockState(prev)
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
    await window.api.thread.delete(v, id)
    set((s) => {
      const next = { ...s.threadsById }
      delete next[id]
      return {
        threadsById: next,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
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

    if (t.agent !== 'machina-native') return
    const history = t.messages
      .slice(0, -1)
      .flatMap((m) =>
        m.role === 'user' || m.role === 'assistant'
          ? [{ role: m.role, content: m.body } as const]
          : []
      )
    await window.api.agentNative.run({
      vaultPath: v,
      threadId: id,
      model: t.model,
      systemPrompt: MACHINA_NATIVE_SYSTEM_PROMPT,
      userMessage: text,
      historyMessages: history
    })
  },

  appendAssistantStreamChunk: (threadId, chunk) =>
    set((s) => ({
      streamingByThreadId: {
        ...s.streamingByThreadId,
        [threadId]: (s.streamingByThreadId[threadId] ?? '') + chunk
      }
    })),

  finalizeAssistantMessage: async (threadId) => {
    const v = get().vaultPath
    const buf = get().streamingByThreadId[threadId] ?? ''
    if (!v) return
    set((s) => {
      const t = s.threadsById[threadId]
      if (!t) return s
      const now = new Date().toISOString()
      const msg: ThreadMessage = { role: 'assistant', body: buf, sentAt: now }
      const next: Thread = { ...t, messages: [...t.messages, msg], lastMessage: now }
      const stream = { ...s.streamingByThreadId }
      delete stream[threadId]
      return {
        threadsById: { ...s.threadsById, [threadId]: next },
        streamingByThreadId: stream
      }
    })
    const t = get().threadsById[threadId]
    if (t) await window.api.thread.save(v, t)
  },

  addDockTab: (tab) => {
    const id = get().activeThreadId
    if (!id) return
    set((s) => ({
      dockTabsByThreadId: {
        ...s.dockTabsByThreadId,
        [id]: [...(s.dockTabsByThreadId[id] ?? []), tab]
      }
    }))
  },

  removeDockTab: (index) => {
    const id = get().activeThreadId
    if (!id) return
    set((s) => {
      const tabs = (s.dockTabsByThreadId[id] ?? []).slice()
      tabs.splice(index, 1)
      return { dockTabsByThreadId: { ...s.dockTabsByThreadId, [id]: tabs } }
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
  }
}))

async function flushDockState(id: string): Promise<void> {
  const s = useThreadStore.getState()
  const t = s.threadsById[id]
  if (!s.vaultPath || !t) return
  const tabs = s.dockTabsByThreadId[id] ?? []
  const next: Thread = { ...t, dockState: { tabs } }
  useThreadStore.setState({ threadsById: { ...s.threadsById, [id]: next } })
  await window.api.thread.save(s.vaultPath, next)
}
