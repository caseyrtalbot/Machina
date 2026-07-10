import { create } from 'zustand'

export type ThreadStartStatus = 'starting' | 'ready' | 'indeterminate'
export interface HarnessLaunchGuard {
  readonly status: 'starting' | 'indeterminate'
  readonly threadId?: string
}

interface AgentDispatchState {
  readonly workspacePath: string | null
  readonly workspaceGeneration: number
  readonly threadStartById: Readonly<Record<string, ThreadStartStatus>>
  readonly cancelRequestedByThreadId: Readonly<Record<string, true>>
  readonly closedThreadById: Readonly<Record<string, true>>
  readonly harnessLaunchByWorkspace: Readonly<
    Record<string, Readonly<Record<string, HarnessLaunchGuard>>>
  >
  switchWorkspace: (workspacePath: string, closingThreadIds?: readonly string[]) => number
  setThreadStart: (threadId: string, status: ThreadStartStatus) => void
  beginTurn: (threadId: string) => void
  requestCancel: (threadId: string) => void
  clearCancelRequest: (threadId: string) => void
  settleThread: (threadId: string) => void
  dropThreadRuntime: (threadId: string) => void
  setHarnessLaunch: (workspacePath: string, slug: string, guard: HarnessLaunchGuard | null) => void
}

export const useAgentDispatchStore = create<AgentDispatchState>((set, get) => ({
  workspacePath: null,
  workspaceGeneration: 0,
  threadStartById: {},
  cancelRequestedByThreadId: {},
  closedThreadById: {},
  harnessLaunchByWorkspace: {},

  switchWorkspace: (workspacePath, closingThreadIds = []) => {
    if (get().workspacePath === workspacePath) return get().workspaceGeneration
    const generation = get().workspaceGeneration + 1
    set((state) => {
      const closed = { ...state.closedThreadById }
      const cancel = { ...state.cancelRequestedByThreadId }
      for (const threadId of closingThreadIds) {
        closed[threadId] = true
        cancel[threadId] = true
      }
      return {
        workspacePath,
        workspaceGeneration: generation,
        threadStartById: {},
        closedThreadById: closed,
        cancelRequestedByThreadId: cancel
      }
    })
    return generation
  },

  setThreadStart: (threadId, status) =>
    set((state) => {
      const closed = { ...state.closedThreadById }
      if (status !== 'indeterminate') delete closed[threadId]
      return {
        threadStartById: { ...state.threadStartById, [threadId]: status },
        closedThreadById: closed
      }
    }),

  beginTurn: (threadId) =>
    set((state) => {
      const next = { ...state.cancelRequestedByThreadId }
      delete next[threadId]
      return { cancelRequestedByThreadId: next }
    }),

  requestCancel: (threadId) =>
    set((state) => ({
      cancelRequestedByThreadId: { ...state.cancelRequestedByThreadId, [threadId]: true }
    })),

  clearCancelRequest: (threadId) =>
    set((state) => {
      const next = { ...state.cancelRequestedByThreadId }
      delete next[threadId]
      return { cancelRequestedByThreadId: next }
    }),

  settleThread: (threadId) =>
    set((state) => {
      const cancel = { ...state.cancelRequestedByThreadId }
      if (!state.closedThreadById[threadId]) delete cancel[threadId]
      const harness = Object.fromEntries(
        Object.entries(state.harnessLaunchByWorkspace).map(([workspacePath, launches]) => [
          workspacePath,
          Object.fromEntries(
            Object.entries(launches).filter(([, guard]) => guard.threadId !== threadId)
          )
        ])
      )
      return { cancelRequestedByThreadId: cancel, harnessLaunchByWorkspace: harness }
    }),

  dropThreadRuntime: (threadId) =>
    set((state) => {
      return {
        threadStartById: { ...state.threadStartById, [threadId]: 'indeterminate' },
        cancelRequestedByThreadId: { ...state.cancelRequestedByThreadId, [threadId]: true },
        closedThreadById: { ...state.closedThreadById, [threadId]: true }
      }
    }),

  setHarnessLaunch: (workspacePath, slug, guard) =>
    set((state) => {
      const launches = { ...(state.harnessLaunchByWorkspace[workspacePath] ?? {}) }
      if (guard === null) delete launches[slug]
      else launches[slug] = guard
      return {
        harnessLaunchByWorkspace: {
          ...state.harnessLaunchByWorkspace,
          [workspacePath]: launches
        }
      }
    })
}))

export function threadStartIsBlocked(status: ThreadStartStatus | undefined): boolean {
  return status === 'starting' || status === 'indeterminate'
}

export function threadRuntimeIsClosed(threadId: string): boolean {
  return useAgentDispatchStore.getState().closedThreadById[threadId] === true
}

export interface WorkspaceDispatchToken {
  readonly workspacePath: string
  readonly generation: number
}

export function captureWorkspaceDispatch(workspacePath: string): WorkspaceDispatchToken {
  const state = useAgentDispatchStore.getState()
  const generation = state.switchWorkspace(workspacePath)
  return { workspacePath, generation }
}

export function workspaceDispatchIsCurrent(token: WorkspaceDispatchToken): boolean {
  const state = useAgentDispatchStore.getState()
  return (
    state.workspacePath === token.workspacePath && state.workspaceGeneration === token.generation
  )
}
