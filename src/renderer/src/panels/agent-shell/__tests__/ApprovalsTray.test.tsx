/**
 * Tests for the ApprovalsTray (workstation step 3, contracts §4).
 *
 * State is seeded directly into useApprovalsStore with crafted PendingChange
 * objects — no IPC bridge. The store's refresh/resolve actions are replaced
 * with stubs so the component's mount/open refresh effects are inert.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { PendingChange, PendingChangeFlags, WatcherHealth } from '@shared/git-types'
import { useApprovalsStore } from '../../../store/approvals-store'
import { ApprovalsTray } from '../ApprovalsTray'
import { flagChips } from '../approval-flags'

const noFlags: PendingChangeFlags = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  gateDegraded: false,
  attributionSuspect: false,
  forbidden: false
}

const allFlags: PendingChangeFlags = {
  highVelocity: true,
  headMoved: true,
  concurrentTurns: true,
  degradedAttribution: true,
  gateDegraded: true,
  attributionSuspect: true,
  forbidden: true
}

const makeHealth = (overrides: Partial<WatcherHealth> = {}): WatcherHealth => ({
  state: 'down',
  since: '2026-07-06T00:00:00.000Z',
  attempts: 0,
  ...overrides
})

const makeItem = (overrides: Partial<PendingChange> = {}): PendingChange => ({
  id: 'pc_t1',
  kind: 'cli-change',
  threadId: 'thread-1',
  agentId: 'agent-a',
  paths: ['src/a.ts'],
  diff: '',
  capturedAt: '2026-07-05T00:00:00.000Z',
  revertible: true,
  flags: noFlags,
  ...overrides
})

const seed = (items: readonly PendingChange[]) => {
  useApprovalsStore.setState({ items, pending: items.length })
}

const openTray = () => {
  fireEvent.click(screen.getByTestId('approvals-tray-button'))
}

beforeEach(() => {
  useApprovalsStore.setState(useApprovalsStore.getInitialState())
  useApprovalsStore.setState({
    refresh: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue({ ok: true }),
    refreshWatcherHealth: vi.fn().mockResolvedValue(undefined),
    retryWatcher: vi.fn().mockResolvedValue(undefined)
  })
})

describe('ApprovalsTray badge', () => {
  it('hides the badge when pending is 0', () => {
    render(<ApprovalsTray />)
    expect(screen.queryByTestId('approvals-tray-badge')).toBeNull()
  })

  it('shows the pending count when pending > 0', () => {
    seed([makeItem(), makeItem({ id: 'pc_t2' }), makeItem({ id: 'pc_t3' })])
    render(<ApprovalsTray />)
    expect(screen.getByTestId('approvals-tray-badge').textContent).toBe('3')
  })
})

describe('ApprovalsTray popover', () => {
  it('opening the popover lists the pending items', () => {
    seed([makeItem(), makeItem({ id: 'pc_t2', agentId: 'agent-b', threadId: 'thread-2' })])
    render(<ApprovalsTray />)
    openTray()

    expect(screen.getByTestId('approvals-popover')).toBeTruthy()
    expect(screen.getAllByTestId('approval-item')).toHaveLength(2)
    expect(screen.getByText('agent-a')).toBeTruthy()
    expect(screen.getByText('agent-b')).toBeTruthy()
  })

  it('disables Reject for a non-revertible cli-change but not for a gate-confirm', () => {
    seed([
      makeItem({ id: 'pc_cli', kind: 'cli-change', revertible: false }),
      makeItem({ id: 'pc_gate', kind: 'gate-confirm', revertible: false })
    ])
    render(<ApprovalsTray />)
    openTray()

    const rejects = screen.getAllByTestId<HTMLButtonElement>('approval-reject')
    expect(rejects).toHaveLength(2)
    expect(rejects[0].disabled).toBe(true)
    expect(rejects[1].disabled).toBe(false)
  })

  it('renders one chip per tripped flag plus the headMoved banner', () => {
    seed([makeItem({ revertible: false, flags: allFlags })])
    render(<ApprovalsTray />)
    openTray()

    expect(screen.getByTestId('approval-flag-forbidden').textContent).toBe('Forbidden path')
    expect(screen.getByTestId('approval-flag-head-moved').textContent).toBe(
      'History rewritten during turn'
    )
    expect(screen.getByTestId('approval-flag-high-velocity').textContent).toBe('High-velocity')
    expect(screen.getByTestId('approval-flag-degraded').textContent).toBe('Attribution degraded')
    expect(screen.getByTestId('approval-flag-gate-degraded').textContent).toBe(
      'Containment degraded'
    )
    expect(screen.getByTestId('approval-flag-concurrent').textContent).toBe('Concurrent turns')
    expect(screen.getByTestId('approval-flag-no-rollback').textContent).toBe('No rollback')
    expect(screen.getByTestId('approval-headmoved-banner')).toBeTruthy()
  })

  it('shows the honest post-persistence copy in the footer', () => {
    render(<ApprovalsTray />)
    openTray()
    expect(screen.getByText(/already on disk/)).toBeTruthy()
  })

  it('clicking Approve resolves the item with (id, true)', () => {
    seed([makeItem({ id: 'pc_t1' })])
    render(<ApprovalsTray />)
    openTray()

    fireEvent.click(screen.getByTestId('approval-approve'))

    expect(useApprovalsStore.getState().resolve).toHaveBeenCalledWith('pc_t1', true)
  })
})

describe('ApprovalsTray multi-root items (contracts §4 v1.3.0)', () => {
  const seedWithRoot = (items: readonly PendingChange[], activeRoot: string | null) => {
    useApprovalsStore.setState({ items, pending: items.length, activeRoot })
  }

  it('same-root items render unchanged: no root label, Approve/Reject live', () => {
    seedWithRoot([makeItem({ capturedRoot: '/ws/alpha' })], '/ws/alpha')
    render(<ApprovalsTray />)
    openTray()

    expect(screen.queryByTestId('approval-root-label')).toBeNull()
    expect(screen.queryByTestId('approval-foreign-root')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('approval-approve').disabled).toBe(false)
    expect(screen.getByTestId<HTMLButtonElement>('approval-reject').disabled).toBe(false)
  })

  it('pre-v1.3.0 items (no capturedRoot) render unchanged too', () => {
    seedWithRoot([makeItem()], '/ws/alpha')
    render(<ApprovalsTray />)
    openTray()

    expect(screen.queryByTestId('approval-root-label')).toBeNull()
    expect(screen.getByTestId('approval-approve')).toBeTruthy()
  })

  it('a foreign-root item shows its root label and the switch affordance, never Approve/Reject', () => {
    seedWithRoot([makeItem({ capturedRoot: '/ws/beta' })], '/ws/alpha')
    render(<ApprovalsTray />)
    openTray()

    const label = screen.getByTestId('approval-root-label')
    expect(label.textContent).toBe('beta')
    expect(label.getAttribute('title')).toBe('/ws/beta')

    const switchBtn = screen.getByTestId('approval-switch-root')
    expect(switchBtn.textContent).toBe('Switch to beta to resolve')
    expect(screen.queryByTestId('approval-approve')).toBeNull()
    expect(screen.queryByTestId('approval-reject')).toBeNull()
  })

  it('clicking the switch affordance dispatches te:open-vault with the capturedRoot (never resolve)', () => {
    seedWithRoot([makeItem({ capturedRoot: '/ws/beta' })], '/ws/alpha')
    const opened: string[] = []
    const onOpenVault = (e: Event) => opened.push((e as CustomEvent<string>).detail)
    window.addEventListener('te:open-vault', onOpenVault)
    try {
      render(<ApprovalsTray />)
      openTray()
      fireEvent.click(screen.getByTestId('approval-switch-root'))
    } finally {
      window.removeEventListener('te:open-vault', onOpenVault)
    }

    expect(opened).toEqual(['/ws/beta'])
    expect(useApprovalsStore.getState().resolve).not.toHaveBeenCalled()
  })

  it('an item captured with no workspace open shows honest copy and no actions at all', () => {
    seedWithRoot([makeItem({ capturedRoot: null })], '/ws/alpha')
    render(<ApprovalsTray />)
    openTray()

    const block = screen.getByTestId('approval-foreign-root')
    expect(block.textContent).toContain('Captured with no workspace open')
    expect(screen.queryByTestId('approval-switch-root')).toBeNull()
    expect(screen.queryByTestId('approval-approve')).toBeNull()
    expect(screen.queryByTestId('approval-reject')).toBeNull()
  })

  it('mixed queue: each item keeps its own affordance', () => {
    seedWithRoot(
      [
        makeItem({ id: 'pc_here', capturedRoot: '/ws/alpha' }),
        makeItem({ id: 'pc_there', capturedRoot: '/ws/beta', threadId: 'thread-2' })
      ],
      '/ws/alpha'
    )
    render(<ApprovalsTray />)
    openTray()

    expect(screen.getAllByTestId('approval-item')).toHaveLength(2)
    expect(screen.getAllByTestId('approval-approve')).toHaveLength(1)
    expect(screen.getAllByTestId('approval-switch-root')).toHaveLength(1)
  })
})

describe('ApprovalsTray watcher health (contracts §4 v1.2.1)', () => {
  it('shows no warning badge or banner while watching, stopped, or unknown', () => {
    for (const health of [
      null,
      makeHealth({ state: 'watching' }),
      makeHealth({ state: 'stopped' })
    ]) {
      useApprovalsStore.setState({ watcherHealth: health })
      const { unmount } = render(<ApprovalsTray />)
      openTray()
      expect(screen.queryByTestId('approvals-watcher-warning')).toBeNull()
      expect(screen.queryByTestId('approvals-watcher-banner')).toBeNull()
      unmount()
    }
  })

  it('shows the warning badge on the trigger even with zero pending items', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    render(<ApprovalsTray />)
    expect(screen.queryByTestId('approvals-tray-badge')).toBeNull()
    expect(screen.getByTestId('approvals-watcher-warning')).toBeTruthy()
  })

  it.each(['starting', 'degraded', 'down'] as const)(
    'renders the honest banner + Retry when state is %s',
    (state) => {
      useApprovalsStore.setState({ watcherHealth: makeHealth({ state }) })
      render(<ApprovalsTray />)
      openTray()

      const banner = screen.getByTestId('approvals-watcher-banner')
      expect(banner.textContent).toContain('Write containment is not watching.')
      expect(banner.textContent).toContain('are not being captured for review')
      expect(screen.getByTestId('approvals-watcher-retry')).toBeTruthy()
    }
  )

  it('clicking Retry invokes the store retryWatcher action (approvals:watcher-retry)', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }) })
    render(<ApprovalsTray />)
    openTray()

    fireEvent.click(screen.getByTestId('approvals-watcher-retry'))

    expect(useApprovalsStore.getState().retryWatcher).toHaveBeenCalledTimes(1)
  })

  it('disables Retry while a retry round-trip is in flight', () => {
    useApprovalsStore.setState({ watcherHealth: makeHealth({ state: 'down' }), retrying: true })
    render(<ApprovalsTray />)
    openTray()

    expect(screen.getByTestId<HTMLButtonElement>('approvals-watcher-retry').disabled).toBe(true)
  })
})

describe('ApprovalsTray revert section (workstation step 5, contracts v1.2.5)', () => {
  it('mounts RevertAgentSection collapsed in the popover — no enumeration on open', () => {
    // window.api is deliberately NOT stubbed: a collapsed section must not
    // touch the git bridge at all.
    render(<ApprovalsTray />)
    openTray()
    const toggle = screen.getByTestId('revert-agent-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('te:revert-agent (palette route) opens the popover with the confirm armed', async () => {
    const listAgentCommits = vi.fn().mockResolvedValue({
      ok: true,
      agents: [
        {
          agentId: 'test-fixer',
          shas: ['aaa1'],
          lastSubject: 'fix: retry loop',
          lastDate: '2026-07-07T10:00:00.000Z'
        }
      ]
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = { git: { listAgentCommits, revertAgent: vi.fn() } }

    render(<ApprovalsTray />)
    act(() => {
      window.dispatchEvent(new CustomEvent('te:revert-agent', { detail: 'test-fixer' }))
    })

    expect(screen.getByTestId('approvals-popover')).toBeTruthy()
    const confirm = await screen.findByTestId('revert-agent-confirm')
    expect(confirm.textContent).toContain('test-fixer')
    expect(confirm.textContent).toContain('creates new commits')
  })
})

describe('flagChips', () => {
  it('returns no chips for a revertible cli-change with no flags', () => {
    expect(flagChips(makeItem())).toEqual([])
  })

  it('adds No rollback only for non-revertible cli-changes', () => {
    const cli = flagChips(makeItem({ revertible: false }))
    expect(cli.map((c) => c.key)).toEqual(['no-rollback'])
    expect(cli[0].label).toBe('No rollback')

    const gate = flagChips(makeItem({ kind: 'gate-confirm', revertible: false }))
    expect(gate).toEqual([])
  })

  it('maps each flag to its chip', () => {
    const cases: readonly [keyof PendingChangeFlags, string, string][] = [
      ['forbidden', 'forbidden', 'Forbidden path'],
      ['headMoved', 'head-moved', 'History rewritten during turn'],
      ['highVelocity', 'high-velocity', 'High-velocity'],
      ['degradedAttribution', 'degraded', 'Attribution degraded'],
      ['attributionSuspect', 'attribution-suspect', 'Attribution suspect'],
      ['gateDegraded', 'gate-degraded', 'Containment degraded'],
      ['concurrentTurns', 'concurrent', 'Concurrent turns']
    ]
    for (const [flag, key, label] of cases) {
      const chips = flagChips(makeItem({ flags: { ...noFlags, [flag]: true } }))
      expect(chips).toHaveLength(1)
      expect(chips[0].key).toBe(key)
      expect(chips[0].label).toBe(label)
    }
  })

  it('emits all eight chips together, No rollback first', () => {
    const chips = flagChips(makeItem({ revertible: false, flags: allFlags }))
    expect(chips.map((c) => c.key)).toEqual([
      'no-rollback',
      'forbidden',
      'head-moved',
      'high-velocity',
      'degraded',
      'attribution-suspect',
      'gate-degraded',
      'concurrent'
    ])
  })
})
