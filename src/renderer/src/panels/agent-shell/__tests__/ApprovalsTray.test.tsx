/**
 * Tests for the ApprovalsTray (workstation step 3, contracts §4).
 *
 * State is seeded directly into useApprovalsStore with crafted PendingChange
 * objects — no IPC bridge. The store's refresh/resolve actions are replaced
 * with stubs so the component's mount/open refresh effects are inert.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PendingChange, PendingChangeFlags } from '@shared/git-types'
import { useApprovalsStore } from '../../../store/approvals-store'
import { ApprovalsTray } from '../ApprovalsTray'
import { flagChips } from '../approval-flags'

const noFlags: PendingChangeFlags = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  forbidden: false
}

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
    resolve: vi.fn().mockResolvedValue({ ok: true })
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
    seed([
      makeItem({
        revertible: false,
        flags: {
          highVelocity: true,
          headMoved: true,
          concurrentTurns: true,
          degradedAttribution: true,
          forbidden: true
        }
      })
    ])
    render(<ApprovalsTray />)
    openTray()

    expect(screen.getByTestId('approval-flag-forbidden').textContent).toBe('Forbidden path')
    expect(screen.getByTestId('approval-flag-head-moved').textContent).toBe(
      'History rewritten during turn'
    )
    expect(screen.getByTestId('approval-flag-high-velocity').textContent).toBe('High-velocity')
    expect(screen.getByTestId('approval-flag-degraded').textContent).toBe('Attribution degraded')
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
      ['concurrentTurns', 'concurrent', 'Concurrent turns']
    ]
    for (const [flag, key, label] of cases) {
      const chips = flagChips(makeItem({ flags: { ...noFlags, [flag]: true } }))
      expect(chips).toHaveLength(1)
      expect(chips[0].key).toBe(key)
      expect(chips[0].label).toBe(label)
    }
  })

  it('emits all six chips together, No rollback first', () => {
    const chips = flagChips(
      makeItem({
        revertible: false,
        flags: {
          highVelocity: true,
          headMoved: true,
          concurrentTurns: true,
          degradedAttribution: true,
          forbidden: true
        }
      })
    )
    expect(chips.map((c) => c.key)).toEqual([
      'no-rollback',
      'forbidden',
      'head-moved',
      'high-velocity',
      'degraded',
      'concurrent'
    ])
  })
})
