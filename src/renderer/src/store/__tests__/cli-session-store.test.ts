/**
 * cli-session-store (workstation Phase 2 step 4): the single renderer
 * authority for threadId → sessionId + liveness. Seeded by spawn responses,
 * updated by cli-thread:session-changed, liveness from terminal:exit,
 * hydrated on demand via cli-thread:get-session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type SessionChangedCb = (data: { threadId: string; sessionId: string }) => void
type TerminalExitCb = (data: { sessionId: string; code: number }) => void

const hooks: {
  sessionChangedCb: SessionChangedCb | null
  terminalExitCb: TerminalExitCb | null
  getSession: ReturnType<typeof vi.fn>
} = {
  sessionChangedCb: null,
  terminalExitCb: null,
  getSession: vi.fn()
}

// window.api must exist BEFORE the module import: the store subscribes at
// module level (same pattern as block-store).
;(window as unknown as Record<string, unknown>).api = {
  cliThread: { getSession: hooks.getSession },
  on: {
    cliThreadSessionChanged: (cb: SessionChangedCb) => {
      hooks.sessionChangedCb = cb
    },
    terminalExit: (cb: TerminalExitCb) => {
      hooks.terminalExitCb = cb
    }
  }
}

import { useCliSessionStore } from '../cli-session-store'
import { useAgentDispatchStore } from '../agent-dispatch-store'

beforeEach(() => {
  useCliSessionStore.setState({ byThread: {} })
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  hooks.getSession.mockReset()
})

describe('seed / sessionChanged / liveness', () => {
  it('seed records a live session for the thread', () => {
    useCliSessionStore.getState().seed('t1', 'sess-1')
    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-1',
      live: true
    })
  })

  it('sessionChanged replaces the binding with the fresh live PTY (respawn)', () => {
    const s = useCliSessionStore.getState()
    s.seed('t1', 'sess-old')
    s.markExited('sess-old')
    s.sessionChanged('t1', 'sess-new')
    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-new',
      live: true
    })
  })

  it('markExited flips liveness only for the thread holding that sessionId', () => {
    const s = useCliSessionStore.getState()
    s.seed('t1', 'sess-1')
    s.seed('t2', 'sess-2')
    s.markExited('sess-1')
    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-1',
      live: false
    })
    expect(useCliSessionStore.getState().byThread['t2']).toEqual({
      sessionId: 'sess-2',
      live: true
    })
  })

  it('markExited for an unknown sessionId is a no-op', () => {
    useCliSessionStore.getState().seed('t1', 'sess-1')
    const before = useCliSessionStore.getState().byThread
    useCliSessionStore.getState().markExited('sess-unknown')
    expect(useCliSessionStore.getState().byThread).toBe(before)
  })

  it('a stale exit for a superseded sessionId does not kill the fresh binding', () => {
    const s = useCliSessionStore.getState()
    s.seed('t1', 'sess-old')
    s.sessionChanged('t1', 'sess-new')
    // Late terminal:exit for the OLD PTY must not mark the new one dead.
    s.markExited('sess-old')
    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-new',
      live: true
    })
  })

  it('drop forgets the binding entirely (thread deleted)', () => {
    useCliSessionStore.getState().seed('t1', 'sess-1')
    useCliSessionStore.getState().drop('t1')
    expect(useCliSessionStore.getState().byThread['t1']).toBeUndefined()
  })

  it('a late session-changed event cannot resurrect a deleted thread', () => {
    useCliSessionStore.getState().seed('t1', 'sess-1')
    useAgentDispatchStore.getState().dropThreadRuntime('t1')
    useCliSessionStore.getState().drop('t1')

    useCliSessionStore.getState().sessionChanged('t1', 'sess-late')

    expect(useCliSessionStore.getState().byThread['t1']).toBeUndefined()
  })
})

describe('hydrate (cli-thread:get-session pull)', () => {
  it('applies the main-side binding, including dead sessions', async () => {
    hooks.getSession.mockResolvedValue({ sessionId: 'sess-h', live: false })
    await useCliSessionStore.getState().hydrate('t1')
    expect(hooks.getSession).toHaveBeenCalledWith('t1')
    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-h',
      live: false
    })
  })

  it('leaves the store untouched on a null response (never-spawned thread)', async () => {
    hooks.getSession.mockResolvedValue(null)
    await useCliSessionStore.getState().hydrate('t1')
    expect(useCliSessionStore.getState().byThread['t1']).toBeUndefined()
  })

  it('swallows IPC failures (dead-state default, no throw)', async () => {
    hooks.getSession.mockRejectedValue(new Error('ipc down'))
    await expect(useCliSessionStore.getState().hydrate('t1')).resolves.toBeUndefined()
    expect(useCliSessionStore.getState().byThread['t1']).toBeUndefined()
  })

  it('does not let a stale hydrate overwrite a newer session-changed event', async () => {
    let resolveHydrate: ((value: { sessionId: string; live: boolean } | null) => void) | undefined
    hooks.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveHydrate = resolve
      })
    )
    const hydration = useCliSessionStore.getState().hydrate('t1')
    useCliSessionStore.getState().sessionChanged('t1', 'sess-new')
    resolveHydrate?.({ sessionId: 'sess-old', live: true })
    await hydration

    expect(useCliSessionStore.getState().byThread['t1']).toEqual({
      sessionId: 'sess-new',
      live: true
    })
  })

  it('does not let a pending hydrate repopulate sessions after a workspace reset', async () => {
    let resolveHydrate: ((value: { sessionId: string; live: boolean } | null) => void) | undefined
    hooks.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveHydrate = resolve
      })
    )
    const hydration = useCliSessionStore.getState().hydrate('t1')

    useCliSessionStore.getState().reset()
    resolveHydrate?.({ sessionId: 'sess-old-workspace', live: true })
    await hydration

    expect(useCliSessionStore.getState().byThread).toEqual({})
  })
})

describe('module-level IPC subscriptions (fresh import, window.api stubbed first)', () => {
  // Static ESM imports hoist above the file body, so the top-of-file store
  // import ran before window.api was assigned — subscription wiring needs a
  // fresh module instance (same pattern as block-store-subscription.test.ts).
  beforeEach(() => {
    vi.resetModules()
    hooks.sessionChangedCb = null
    hooks.terminalExitCb = null
  })

  it('subscribes on import and applies cli-thread:session-changed to the store', async () => {
    const fresh = (await import('../cli-session-store')).useCliSessionStore
    expect(hooks.sessionChangedCb).not.toBeNull()
    hooks.sessionChangedCb?.({ threadId: 't9', sessionId: 'sess-evt' })
    expect(fresh.getState().byThread['t9']).toEqual({
      sessionId: 'sess-evt',
      live: true
    })
  })

  it('subscribes to terminal:exit and flips liveness', async () => {
    const fresh = (await import('../cli-session-store')).useCliSessionStore
    fresh.getState().seed('t9', 'sess-evt')
    expect(hooks.terminalExitCb).not.toBeNull()
    hooks.terminalExitCb?.({ sessionId: 'sess-evt', code: 0 })
    expect(fresh.getState().byThread['t9']).toEqual({
      sessionId: 'sess-evt',
      live: false
    })
  })

  it('import without a preload bridge does not throw', async () => {
    const savedApi = (window as unknown as Record<string, unknown>).api
    ;(window as unknown as Record<string, unknown>).api = undefined
    await expect(import('../cli-session-store')).resolves.toBeDefined()
    ;(window as unknown as Record<string, unknown>).api = savedApi
  })
})
