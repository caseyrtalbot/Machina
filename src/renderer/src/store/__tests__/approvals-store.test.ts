/**
 * Unit tests for the approvals store (workstation step 3, contracts §4/§6).
 *
 * The window.api bridge is stubbed via vi.hoisted BEFORE the static store
 * import so the module-level approvals:changed subscription binds against the
 * mock instead of a missing preload bridge (same pattern as
 * block-store-subscription.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GitOpResult, PendingChange, PendingChangeFlags } from '@shared/git-types'

const api = vi.hoisted(() => {
  const stub = {
    approvals: { list: vi.fn(), resolve: vi.fn() },
    on: { approvalsChanged: vi.fn() }
  }
  ;(window as unknown as Record<string, unknown>).api = stub
  return stub
})

// Imported AFTER the hoisted stub so the subscription guard sees window.api.
import { useApprovalsStore, noticeForFailure } from '../approvals-store'

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

beforeEach(() => {
  api.approvals.list.mockReset()
  api.approvals.resolve.mockReset()
  useApprovalsStore.setState(useApprovalsStore.getInitialState())
})

describe('noticeForFailure', () => {
  it('maps each structured reason to its user-facing message', () => {
    expect(noticeForFailure('stale-diff')).toBe(
      'The files changed after this diff was captured. Review the updated diff and decide again.'
    )
    expect(noticeForFailure('workspace-changed')).toBe(
      'This change was captured in a different workspace. Reopen that workspace to resolve it.'
    )
    expect(noticeForFailure('not-a-git-repo')).toBe(
      'This workspace is not a git repository — there is nothing to revert from. The item stays for visibility.'
    )
    expect(noticeForFailure('no-workspace')).toBe('No workspace is open.')
  })

  it('falls back to a generic message for unknown reasons', () => {
    expect(noticeForFailure('quantum-flux')).toBe('Could not resolve: quantum-flux')
  })
})

describe('useApprovalsStore', () => {
  it('refresh() populates items and pending from approvals.list', async () => {
    const items = [makeItem(), makeItem({ id: 'pc_t2', threadId: 'thread-2' })]
    api.approvals.list.mockResolvedValue(items)

    await useApprovalsStore.getState().refresh()

    expect(useApprovalsStore.getState().items).toEqual(items)
    expect(useApprovalsStore.getState().pending).toBe(2)
  })

  it('resolve() success refreshes the list, returns the result, and leaves notice null', async () => {
    const ok: GitOpResult = { ok: true, sha: 'abc123' }
    api.approvals.resolve.mockResolvedValue(ok)
    api.approvals.list.mockResolvedValue([])

    const result = await useApprovalsStore.getState().resolve('pc_t1', true)

    expect(result).toEqual(ok)
    expect(api.approvals.resolve).toHaveBeenCalledWith('pc_t1', true, undefined)
    expect(api.approvals.list).toHaveBeenCalledTimes(1)
    expect(useApprovalsStore.getState().notice).toBeNull()
    expect(useApprovalsStore.getState().items).toEqual([])
    expect(useApprovalsStore.getState().pending).toBe(0)
  })

  it('resolve() stale-diff posts the notice, re-refreshes, and updates items', async () => {
    // Pre-seed with the stale snapshot the user was looking at.
    useApprovalsStore.setState({ items: [makeItem({ diff: 'old' })], pending: 1 })

    const refreshed = [makeItem({ diff: 'new' })]
    api.approvals.resolve.mockResolvedValue({ ok: false, reason: 'stale-diff' })
    api.approvals.list.mockResolvedValue(refreshed)

    const result = await useApprovalsStore.getState().resolve('pc_t1', true)

    expect(result).toEqual({ ok: false, reason: 'stale-diff' })
    expect(useApprovalsStore.getState().notice).toBe(noticeForFailure('stale-diff'))
    expect(api.approvals.list).toHaveBeenCalledTimes(1)
    expect(useApprovalsStore.getState().items).toEqual(refreshed)
    expect(useApprovalsStore.getState().items[0].diff).toBe('new')
  })

  it('resolve() workspace-changed posts its notice', async () => {
    api.approvals.resolve.mockResolvedValue({ ok: false, reason: 'workspace-changed' })
    api.approvals.list.mockResolvedValue([])

    await useApprovalsStore.getState().resolve('pc_t1', false)

    expect(useApprovalsStore.getState().notice).toBe(noticeForFailure('workspace-changed'))
  })

  it('resolve() not-a-git-repo posts its notice', async () => {
    api.approvals.resolve.mockResolvedValue({ ok: false, reason: 'not-a-git-repo' })
    api.approvals.list.mockResolvedValue([])

    await useApprovalsStore.getState().resolve('pc_t1', false)

    expect(useApprovalsStore.getState().notice).toBe(noticeForFailure('not-a-git-repo'))
  })

  it('sets resolving while the resolve round-trip is in flight and clears it after', async () => {
    let release: (result: GitOpResult) => void = () => {
      throw new Error('deferred resolver was not captured')
    }
    api.approvals.resolve.mockImplementation(
      () =>
        new Promise<GitOpResult>((res) => {
          release = res
        })
    )
    api.approvals.list.mockResolvedValue([])

    const inFlight = useApprovalsStore.getState().resolve('pc_t1', true)
    expect(useApprovalsStore.getState().resolving).toBe('pc_t1')

    release({ ok: true })
    await inFlight

    expect(useApprovalsStore.getState().resolving).toBeNull()
  })

  it('clears resolving even when the IPC call rejects', async () => {
    api.approvals.resolve.mockRejectedValue(new Error('ipc boom'))

    await expect(useApprovalsStore.getState().resolve('pc_t1', true)).rejects.toThrow('ipc boom')

    expect(useApprovalsStore.getState().resolving).toBeNull()
  })

  it('the approvals:changed subscription sets pending and refreshes the list', async () => {
    // Registered once at import time against the hoisted stub.
    expect(api.on.approvalsChanged).toHaveBeenCalledTimes(1)
    const onChanged = api.on.approvalsChanged.mock.calls[0][0] as (payload: {
      pending: number
    }) => void

    const items = [makeItem(), makeItem({ id: 'pc_t2' }), makeItem({ id: 'pc_t3' })]
    api.approvals.list.mockResolvedValue(items)

    onChanged({ pending: 3 })

    // setPending fires synchronously with the broadcast count…
    expect(useApprovalsStore.getState().pending).toBe(3)
    // …then the fire-and-forget refresh re-fetches the list.
    await vi.waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(useApprovalsStore.getState().items).toEqual(items))
    expect(useApprovalsStore.getState().pending).toBe(3)
  })

  it('clearNotice() clears an existing notice', () => {
    useApprovalsStore.setState({ notice: 'something happened' })

    useApprovalsStore.getState().clearNotice()

    expect(useApprovalsStore.getState().notice).toBeNull()
  })
})
