/**
 * Circuit-breaker UI (workstation Phase 2 step 6, contracts §5 v1.2.6):
 * tray notice rows (tripped state renders, honest containment copy) and the
 * thread-header kill switch (manual kill wires cli-thread:close; tripped
 * chip shows). IPC is stubbed on window.api; stores reset per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import { useAgentBreakerStore } from '../../../store/agent-breaker-store'
import { useCliSessionStore } from '../../../store/cli-session-store'
import { AgentBreakerNotices } from '../agent-breaker-notice'
import { AgentKillSwitch } from '../agent-breaker-kill-switch'

const status = vi.fn()
const close = vi.fn()
const getSession = vi.fn()

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  status.mockResolvedValue({ trips: [], signalsDegraded: false })
  getSession.mockResolvedValue(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { breaker: { status }, cliThread: { close, getSession } }
  useAgentBreakerStore.setState({ trips: [], signalsDegraded: false })
  useCliSessionStore.setState({ byThread: {} })
})

function trip(overrides: Partial<BreakerTripEvent> = {}): BreakerTripEvent {
  return {
    threadId: 'th1',
    agentId: 'test-fixer',
    reason: 'velocity',
    action: 'killed',
    detail: 'write-rate limiter exceeded on 3 consecutive batches (turn t1)',
    at: '2026-07-07T00:00:00.000Z',
    ...overrides
  }
}

describe('AgentBreakerNotices (tray rows)', () => {
  it('renders nothing with zero trips', async () => {
    render(<AgentBreakerNotices />)
    await act(async () => {})
    expect(screen.queryByTestId('breaker-notices')).toBeNull()
  })

  it('renders a killed trip with containment (never prevention) copy', async () => {
    // The mount refresh is the state source — seed via the status pull.
    status.mockResolvedValue({ trips: [trip()], signalsDegraded: false })
    render(<AgentBreakerNotices />)
    await act(async () => {})
    const row = screen.getByTestId('breaker-notice')
    expect(row.textContent).toContain('test-fixer')
    expect(row.textContent).toContain('sustained write velocity')
    expect(row.textContent).toContain('already on disk')
    expect(screen.getByTestId('breaker-notice-badge').textContent).toBe('breaker tripped')
  })

  it('renders a concurrentTurns notice with manual-kill guidance, not a kill claim', async () => {
    status.mockResolvedValue({
      trips: [trip({ action: 'notice', reason: 'velocity' })],
      signalsDegraded: false
    })
    render(<AgentBreakerNotices />)
    await act(async () => {})
    const row = screen.getByTestId('breaker-notice')
    expect(row.textContent).toContain('ambiguous')
    expect(row.textContent).toContain('Kill control')
    expect(screen.getByTestId('breaker-notice-badge').textContent).toBe('breaker notice')
  })

  it('renders a head-moved notice with user-git-op copy, never a concurrent-turns claim (v1.2.7)', async () => {
    // headMoved is notice-class since v1.2.7: the ambiguity is user-vs-agent
    // git activity, not concurrent turns — the copy must say so.
    status.mockResolvedValue({
      trips: [trip({ action: 'notice', reason: 'head-moved' })],
      signalsDegraded: false
    })
    render(<AgentBreakerNotices />)
    await act(async () => {})
    const row = screen.getByTestId('breaker-notice')
    expect(row.textContent).toContain('your own git activity')
    expect(row.textContent).toContain('Kill control')
    expect(row.textContent).not.toContain('concurrent turns')
    expect(screen.getByTestId('breaker-notice-badge').textContent).toBe('breaker notice')
  })

  it('pulls agent:breaker-status on mount (late-subscriber refresh)', async () => {
    status.mockResolvedValue({ trips: [trip()], signalsDegraded: false })
    render(<AgentBreakerNotices />)
    await act(async () => {})
    expect(status).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('breaker-notice')).toBeDefined()
  })
})

describe('AgentKillSwitch (thread header)', () => {
  it('renders nothing without a live PTY or a trip', async () => {
    render(<AgentKillSwitch threadId="th1" />)
    await act(async () => {})
    expect(screen.queryByTestId('agent-kill-switch')).toBeNull()
    expect(screen.queryByTestId('breaker-tripped-chip')).toBeNull()
  })

  it('manual kill wiring: the button calls cli-thread:close for the thread', async () => {
    useCliSessionStore.setState({ byThread: { th1: { sessionId: 's1', live: true } } })
    close.mockResolvedValue(undefined)
    render(<AgentKillSwitch threadId="th1" />)
    await act(async () => {})
    const button = screen.getByTestId('agent-kill-switch')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(close).toHaveBeenCalledExactlyOnceWith('th1')
  })

  it('tripped state renders the chip even after the PTY died', async () => {
    status.mockResolvedValue({ trips: [trip()], signalsDegraded: false })
    useCliSessionStore.setState({ byThread: { th1: { sessionId: 's1', live: false } } })
    render(<AgentKillSwitch threadId="th1" />)
    await act(async () => {})
    expect(screen.getByTestId('breaker-tripped-chip')).toBeDefined()
    expect(screen.queryByTestId('agent-kill-switch')).toBeNull()
  })

  it('a trip on another thread shows nothing here (keyed per thread)', async () => {
    status.mockResolvedValue({ trips: [trip({ threadId: 'other' })], signalsDegraded: false })
    render(<AgentKillSwitch threadId="th1" />)
    await act(async () => {})
    expect(screen.queryByTestId('breaker-tripped-chip')).toBeNull()
  })
})
