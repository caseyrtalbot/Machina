import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStripStore, clampStripHeight, STRIP_MIN_HEIGHT } from '../terminal-strip-store'
import type { TerminalStripState } from '@shared/dock-types'

const THREAD = 't1'

const killMock = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  useTerminalStripStore.setState(useTerminalStripStore.getInitialState(), true)
  killMock.mockClear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { terminal: { kill: killMock } }
  // Deterministic clamp bounds: max = floor(1000 * 0.6) = 600.
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true, writable: true })
})

const stripOf = (threadId: string): TerminalStripState | undefined =>
  useTerminalStripStore.getState().byThreadId[threadId]

describe('spawn', () => {
  it('adds a session with empty sessionId, activates it, uncollapses, returns tabId', () => {
    useTerminalStripStore.getState().toggleCollapsed(THREAD)
    expect(stripOf(THREAD)?.collapsed).toBe(true)

    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    const strip = stripOf(THREAD)
    expect(strip?.sessions).toEqual([{ tabId, sessionId: '', cwd: '/vault' }])
    expect(strip?.activeTabId).toBe(tabId)
    expect(strip?.collapsed).toBe(false)
  })
})

describe('bindSession', () => {
  it('overwrites the sessionId on the matching tab', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-1')
    expect(stripOf(THREAD)?.sessions[0].sessionId).toBe('live-1')
  })

  it('overwrites a stale persisted sessionId with the fresh one', () => {
    useTerminalStripStore.getState().seed(THREAD, {
      sessions: [{ tabId: 'tab-a', sessionId: 'stale-persisted', cwd: '/vault' }],
      activeTabId: 'tab-a',
      collapsed: false,
      height: 240
    })
    useTerminalStripStore.getState().bindSession(THREAD, 'tab-a', 'fresh-1')
    expect(stripOf(THREAD)?.sessions[0].sessionId).toBe('fresh-1')
  })

  it('ignores unknown tabIds', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, 'nope', 'x')
    expect(stripOf(THREAD)?.sessions).toEqual([{ tabId, sessionId: '', cwd: '/vault' }])
  })
})

describe('close', () => {
  it('kills the PTY exactly once and removes the tab', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-1')

    useTerminalStripStore.getState().close(THREAD, tabId)

    expect(killMock).toHaveBeenCalledTimes(1)
    expect(killMock).toHaveBeenCalledWith('live-1')
    expect(stripOf(THREAD)?.sessions).toHaveLength(0)
  })

  it('does not kill when the session never bound a sessionId', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().close(THREAD, tabId)
    expect(killMock).not.toHaveBeenCalled()
    expect(stripOf(THREAD)?.sessions).toHaveLength(0)
  })

  it('adds no pendingKill entry when closing a bound tab', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-1')

    useTerminalStripStore.getState().close(THREAD, tabId)

    expect(killMock).toHaveBeenCalledTimes(1)
    expect(useTerminalStripStore.getState().pendingKill).toHaveLength(0)
  })
})

describe('pendingKill', () => {
  it('close on an unbound tab defers the kill: no immediate kill, tab removed, entry parked', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')

    useTerminalStripStore.getState().close(THREAD, tabId)

    expect(killMock).not.toHaveBeenCalled()
    expect(stripOf(THREAD)?.sessions).toHaveLength(0)
    expect(useTerminalStripStore.getState().pendingKill).toEqual([
      { threadId: THREAD, tabId, sessionId: '', cwd: '/vault' }
    ])
  })

  it('resolvePendingKill kills by the late-reported id and forgets the entry', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().close(THREAD, tabId)

    useTerminalStripStore.getState().resolvePendingKill(tabId, 'real-id')

    expect(killMock).toHaveBeenCalledTimes(1)
    expect(killMock).toHaveBeenCalledWith('real-id')
    expect(useTerminalStripStore.getState().pendingKill).toHaveLength(0)
  })

  it('resolvePendingKill is a no-op for unknown tabIds', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().close(THREAD, tabId)

    useTerminalStripStore.getState().resolvePendingKill('nope', 'real-id')

    expect(killMock).not.toHaveBeenCalled()
    expect(useTerminalStripStore.getState().pendingKill).toHaveLength(1)
  })

  it('discardPendingKill forgets the entry without killing', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().close(THREAD, tabId)

    useTerminalStripStore.getState().discardPendingKill(tabId)

    expect(killMock).not.toHaveBeenCalled()
    expect(useTerminalStripStore.getState().pendingKill).toHaveLength(0)
  })
})

describe('detach', () => {
  it('removes the tab, never calls terminal.kill, and returns the session', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-1')

    const detached = useTerminalStripStore.getState().detach(THREAD, tabId)

    expect(detached).toEqual({ tabId, sessionId: 'live-1', cwd: '/vault' })
    expect(killMock).not.toHaveBeenCalled()
    expect(stripOf(THREAD)?.sessions).toHaveLength(0)
  })

  it('returns null for unknown tabIds', () => {
    expect(useTerminalStripStore.getState().detach(THREAD, 'nope')).toBeNull()
  })

  it('detach→attach round-trip preserves the same sessionId with zero kills (migration seam, Phase 3 step 3)', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/proj')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-rt')

    const detached = useTerminalStripStore.getState().detach(THREAD, tabId)
    expect(detached?.sessionId).toBe('live-rt')
    const newTabId = useTerminalStripStore
      .getState()
      .attach(THREAD, { sessionId: detached!.sessionId, cwd: detached!.cwd })

    expect(stripOf(THREAD)?.sessions).toEqual([
      { tabId: newTabId, sessionId: 'live-rt', cwd: '/proj' }
    ])
    expect(killMock).not.toHaveBeenCalled()
  })
})

describe('attach', () => {
  it('adds a live session, activates it, and uncollapses', () => {
    useTerminalStripStore.getState().toggleCollapsed(THREAD)

    const tabId = useTerminalStripStore
      .getState()
      .attach(THREAD, { sessionId: 'live-9', cwd: '/proj' })

    const strip = stripOf(THREAD)
    expect(strip?.sessions).toEqual([{ tabId, sessionId: 'live-9', cwd: '/proj' }])
    expect(strip?.activeTabId).toBe(tabId)
    expect(strip?.collapsed).toBe(false)
  })
})

describe('setActive', () => {
  it('activates a known tab and ignores unknown tabIds', () => {
    const t1 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    const t2 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    expect(stripOf(THREAD)?.activeTabId).toBe(t2)

    useTerminalStripStore.getState().setActive(THREAD, t1)
    expect(stripOf(THREAD)?.activeTabId).toBe(t1)

    useTerminalStripStore.getState().setActive(THREAD, 'unknown')
    expect(stripOf(THREAD)?.activeTabId).toBe(t1)
  })
})

describe('toggleCollapsed', () => {
  it('flips the collapsed flag', () => {
    useTerminalStripStore.getState().toggleCollapsed(THREAD)
    expect(stripOf(THREAD)?.collapsed).toBe(true)
    useTerminalStripStore.getState().toggleCollapsed(THREAD)
    expect(stripOf(THREAD)?.collapsed).toBe(false)
  })
})

describe('setHeight', () => {
  it('clamps to the [120, floor(innerHeight * 0.6)] range', () => {
    const max = Math.floor(window.innerHeight * 0.6)
    expect(max).toBe(600)

    useTerminalStripStore.getState().setHeight(THREAD, 50)
    expect(stripOf(THREAD)?.height).toBe(STRIP_MIN_HEIGHT)

    useTerminalStripStore.getState().setHeight(THREAD, 5000)
    expect(stripOf(THREAD)?.height).toBe(max)

    useTerminalStripStore.getState().setHeight(THREAD, 300)
    expect(stripOf(THREAD)?.height).toBe(300)
  })

  it('clampStripHeight matches the documented bounds', () => {
    expect(clampStripHeight(0)).toBe(120)
    expect(clampStripHeight(10_000)).toBe(600)
    expect(clampStripHeight(240)).toBe(240)
  })
})

describe('seed', () => {
  it('is a no-op for undefined (legacy thread files)', () => {
    useTerminalStripStore.getState().seed(THREAD, undefined)
    expect(stripOf(THREAD)).toBeUndefined()
  })

  it('restores persisted state with the height re-clamped', () => {
    useTerminalStripStore.getState().seed(THREAD, {
      sessions: [{ tabId: 'tab-a', sessionId: 'old', cwd: '/vault' }],
      activeTabId: 'tab-a',
      collapsed: true,
      height: 99_999
    })
    const strip = stripOf(THREAD)
    expect(strip?.sessions).toHaveLength(1)
    expect(strip?.activeTabId).toBe('tab-a')
    expect(strip?.collapsed).toBe(true)
    expect(strip?.height).toBe(600)
  })

  it('is first-write-wins: never clobbers live in-memory state', () => {
    const tabId = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, tabId, 'live-1')

    useTerminalStripStore.getState().seed(THREAD, {
      sessions: [{ tabId: 'tab-disk', sessionId: 'stale', cwd: '/old' }],
      activeTabId: 'tab-disk',
      collapsed: true,
      height: 240
    })

    // The live entry survives untouched...
    expect(stripOf(THREAD)?.sessions).toEqual([{ tabId, sessionId: 'live-1', cwd: '/vault' }])
    expect(stripOf(THREAD)?.collapsed).toBe(false)

    // ...while a fresh threadId still restores from disk.
    useTerminalStripStore.getState().seed('t2', {
      sessions: [{ tabId: 'tab-disk', sessionId: 'stale', cwd: '/old' }],
      activeTabId: 'tab-disk',
      collapsed: true,
      height: 240
    })
    expect(stripOf('t2')?.sessions).toEqual([
      { tabId: 'tab-disk', sessionId: 'stale', cwd: '/old' }
    ])
  })
})

describe('drop', () => {
  it('removes the thread entry', () => {
    useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().drop(THREAD)
    expect(stripOf(THREAD)).toBeUndefined()
  })

  it('is a no-op for unknown threads', () => {
    const before = useTerminalStripStore.getState().byThreadId
    useTerminalStripStore.getState().drop('nope')
    expect(useTerminalStripStore.getState().byThreadId).toBe(before)
  })

  it('kills each bound PTY exactly once and skips unbound sessions', () => {
    const t1 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().bindSession(THREAD, t1, 'live-1')

    useTerminalStripStore.getState().drop(THREAD)

    expect(killMock).toHaveBeenCalledTimes(1)
    expect(killMock).toHaveBeenCalledWith('live-1')
    expect(stripOf(THREAD)).toBeUndefined()
  })

  it("sweeps the dropped thread's pendingKill entries but keeps other threads'", () => {
    const t1 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    useTerminalStripStore.getState().close(THREAD, t1) // unbound → parked
    const other = useTerminalStripStore.getState().spawn('other-thread', '/vault')
    useTerminalStripStore.getState().close('other-thread', other)
    expect(useTerminalStripStore.getState().pendingKill).toHaveLength(2)

    useTerminalStripStore.getState().drop(THREAD)

    const remaining = useTerminalStripStore.getState().pendingKill
    expect(remaining).toHaveLength(1)
    expect(remaining[0].threadId).toBe('other-thread')
    expect(killMock).not.toHaveBeenCalled()
  })
})

describe('active-tab fallback on removal', () => {
  it('activates the last remaining tab when the active tab is removed', () => {
    const t1 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    const t2 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    const t3 = useTerminalStripStore.getState().spawn(THREAD, '/vault')
    expect(stripOf(THREAD)?.activeTabId).toBe(t3)

    useTerminalStripStore.getState().detach(THREAD, t3)
    expect(stripOf(THREAD)?.activeTabId).toBe(t2)

    // Removing a non-active tab leaves the active tab untouched.
    useTerminalStripStore.getState().detach(THREAD, t1)
    expect(stripOf(THREAD)?.activeTabId).toBe(t2)

    useTerminalStripStore.getState().detach(THREAD, t2)
    expect(stripOf(THREAD)?.activeTabId).toBeNull()
  })
})
