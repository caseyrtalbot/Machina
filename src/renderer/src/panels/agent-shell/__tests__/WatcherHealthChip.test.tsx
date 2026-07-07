/**
 * Thread-surface watcher-health signals (workstation step 2, contracts §4
 * v1.2.1): the compact degraded chip and the one-time inline turn notice.
 * State is seeded directly into the approvals + thread stores — no IPC.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import type { WatcherHealth } from '@shared/git-types'
import { useApprovalsStore } from '../../../store/approvals-store'
import { useThreadStore } from '../../../store/thread-store'
import { WatcherHealthChip, WatcherHealthNotice } from '../WatcherHealthChip'

const makeHealth = (overrides: Partial<WatcherHealth> = {}): WatcherHealth => ({
  state: 'down',
  since: '2026-07-06T00:00:00.000Z',
  attempts: 0,
  ...overrides
})

beforeEach(() => {
  useApprovalsStore.setState(useApprovalsStore.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
})

describe('WatcherHealthChip', () => {
  it('renders nothing while health is unknown, watching, or stopped', () => {
    for (const health of [
      null,
      makeHealth({ state: 'watching' }),
      makeHealth({ state: 'stopped' })
    ]) {
      useApprovalsStore.setState({ watcherHealth: health })
      const { unmount } = render(<WatcherHealthChip />)
      expect(screen.queryByTestId('thread-watcher-chip')).toBeNull()
      unmount()
    }
  })

  it.each(['starting', 'degraded', 'down'] as const)('shows the %s state', (state) => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state }) })
    render(<WatcherHealthChip />)
    expect(screen.getByTestId('thread-watcher-chip').textContent).toBe(`containment ${state}`)
  })
})

describe('WatcherHealthNotice', () => {
  it('stays hidden while the watcher is healthy, even with a turn in flight', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'watching' }) })
    useThreadStore.setState({ inFlightByThreadId: { t1: true } })
    render(<WatcherHealthNotice threadId="t1" />)
    expect(screen.queryByTestId('thread-watcher-notice')).toBeNull()
  })

  it('stays hidden while unhealthy but no turn is in flight', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    render(<WatcherHealthNotice threadId="t1" />)
    expect(screen.queryByTestId('thread-watcher-notice')).toBeNull()
  })

  it('latches when a turn runs while unhealthy, with honest never-blocked copy', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    render(<WatcherHealthNotice threadId="t1" />)

    act(() => {
      useThreadStore.setState({ inFlightByThreadId: { t1: true } })
    })

    const notice = screen.getByTestId('thread-watcher-notice')
    expect(notice.textContent).toContain('Write containment is not watching.')
    expect(notice.textContent).toContain('not being captured for review')
    expect(notice.textContent).not.toMatch(/blocked/i)
  })

  it('is one-time: stays shown after the watcher recovers and the turn ends', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    render(<WatcherHealthNotice threadId="t1" />)

    act(() => {
      useThreadStore.setState({ inFlightByThreadId: { t1: true } })
    })
    expect(screen.getByTestId('thread-watcher-notice')).toBeTruthy()

    act(() => {
      useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'watching' }) })
      useThreadStore.setState({ inFlightByThreadId: {} })
    })
    expect(screen.getByTestId('thread-watcher-notice')).toBeTruthy()
  })

  it("only this thread's in-flight turn latches the notice", () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    useThreadStore.setState({ inFlightByThreadId: { other: true } })
    render(<WatcherHealthNotice threadId="t1" />)
    expect(screen.queryByTestId('thread-watcher-notice')).toBeNull()
  })
})
