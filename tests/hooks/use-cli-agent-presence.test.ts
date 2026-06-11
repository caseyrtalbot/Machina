// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { CLIAgentSessionStatus } from '../../src/shared/cli-agent-session-types'

type StatusCb = (data: CLIAgentSessionStatus) => void
type ExitCb = (data: { sessionId: string; code: number }) => void

const mockSessionStatus = vi.fn<(cb: StatusCb) => () => void>()
const mockContextUpdated = vi.fn<(cb: StatusCb) => () => void>()
const mockTerminalExit = vi.fn<(cb: ExitCb) => () => void>()

vi.stubGlobal('window', {
  api: {
    on: {
      cliAgentSessionStatus: mockSessionStatus,
      cliAgentContextUpdated: mockContextUpdated,
      terminalExit: mockTerminalExit
    }
  }
})

// Import after mocks are set up
const { useCliAgentPresence, foldAgentEvent, clearSessionPresence } =
  await import('../../src/renderer/src/hooks/use-cli-agent-presence')

function makeEvent(overrides?: Partial<CLIAgentSessionStatus>): CLIAgentSessionStatus {
  return {
    agentId: 'claude',
    sessionId: 'sess-1',
    status: 'in-progress',
    context: {
      cwd: '/tmp/project',
      project: 'project',
      sessionId: 'sess-1',
      toolName: null,
      toolInputPreview: null,
      summary: null,
      query: 'fix the bug',
      response: null
    },
    ...overrides
  }
}

describe('foldAgentEvent', () => {
  it('adds a presence entry when a session status first appears', () => {
    const next = foldAgentEvent({}, makeEvent())
    expect(next).toEqual({ 'sess-1': { agentId: 'claude', status: 'in-progress' } })
  })

  it('updates the entry when the status transitions', () => {
    const start = foldAgentEvent({}, makeEvent())
    const next = foldAgentEvent(start, makeEvent({ status: 'success' }))
    expect(next['sess-1']).toEqual({ agentId: 'claude', status: 'success' })
  })

  it('returns the same map reference when nothing changed', () => {
    const start = foldAgentEvent({}, makeEvent())
    const next = foldAgentEvent(start, makeEvent())
    expect(next).toBe(start)
  })

  it('tracks sessions independently and does not mutate the input map', () => {
    const start = foldAgentEvent({}, makeEvent())
    const next = foldAgentEvent(start, makeEvent({ sessionId: 'sess-2', agentId: 'codex' }))
    expect(next).toEqual({
      'sess-1': { agentId: 'claude', status: 'in-progress' },
      'sess-2': { agentId: 'codex', status: 'in-progress' }
    })
    expect(start).toEqual({ 'sess-1': { agentId: 'claude', status: 'in-progress' } })
  })
})

describe('clearSessionPresence', () => {
  it('removes the session entry', () => {
    const start = foldAgentEvent({}, makeEvent())
    expect(clearSessionPresence(start, 'sess-1')).toEqual({})
  })

  it('returns the same map reference for unknown sessions', () => {
    const start = foldAgentEvent({}, makeEvent())
    expect(clearSessionPresence(start, 'sess-nope')).toBe(start)
  })
})

describe('useCliAgentPresence', () => {
  let statusCb: StatusCb | null
  let contextCb: StatusCb | null
  let exitCb: ExitCb | null
  let offStatus: ReturnType<typeof vi.fn>
  let offContext: ReturnType<typeof vi.fn>
  let offExit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    statusCb = null
    contextCb = null
    exitCb = null
    offStatus = vi.fn()
    offContext = vi.fn()
    offExit = vi.fn()
    mockSessionStatus.mockReset().mockImplementation((cb) => {
      statusCb = cb
      return offStatus
    })
    mockContextUpdated.mockReset().mockImplementation((cb) => {
      contextCb = cb
      return offContext
    })
    mockTerminalExit.mockReset().mockImplementation((cb) => {
      exitCb = cb
      return offExit
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('starts empty and surfaces a session once a status event arrives', () => {
    const { result } = renderHook(() => useCliAgentPresence())
    expect(result.current).toEqual({})

    act(() => statusCb?.(makeEvent()))
    expect(result.current).toEqual({ 'sess-1': { agentId: 'claude', status: 'in-progress' } })
  })

  it('updates status on later events, including context-updated', () => {
    const { result } = renderHook(() => useCliAgentPresence())

    act(() => statusCb?.(makeEvent()))
    act(() => contextCb?.(makeEvent({ status: 'blocked' })))

    expect(result.current['sess-1']).toEqual({ agentId: 'claude', status: 'blocked' })
  })

  it('clears the session when its terminal exits', () => {
    const { result } = renderHook(() => useCliAgentPresence())

    act(() => statusCb?.(makeEvent()))
    act(() => statusCb?.(makeEvent({ sessionId: 'sess-2', agentId: 'gemini' })))
    act(() => exitCb?.({ sessionId: 'sess-1', code: 0 }))

    expect(result.current).toEqual({ 'sess-2': { agentId: 'gemini', status: 'in-progress' } })
  })

  it('unsubscribes from all three channels on unmount', () => {
    const { unmount } = renderHook(() => useCliAgentPresence())
    unmount()

    expect(offStatus).toHaveBeenCalledOnce()
    expect(offContext).toHaveBeenCalledOnce()
    expect(offExit).toHaveBeenCalledOnce()
  })
})
