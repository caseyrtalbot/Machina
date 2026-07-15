// @vitest-environment node
/**
 * Native-hold queue mirror (Phase 3 step 2, contracts §4 v1.3.1).
 *
 * Single resolution authority: context.ts's approvals map. Whichever surface
 * settles a hold first — the approvals tray (queue resolve), the chat diff
 * card (decideApproval via IPC), or a run abort (clearApproval) — the
 * decision lands exactly once and the mirror row disappears. These tests
 * drive the REAL ApprovalQueue + REAL context map + REAL mirror module wired
 * exactly as production wires them (setNativeHoldQueueProvider's listener).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ApprovalQueue } from '../../../src/main/services/approval-queue'
import {
  awaitApproval,
  clearApproval,
  decideApproval,
  setHoldSettledListener
} from '../../../src/main/services/machina-native-tools/context'
import {
  mirrorNativeHold,
  releaseNativeHold,
  resetNativeHoldMirror
} from '../../../src/main/services/machina-native-tools/queue-mirror'
import type { AgentNativeApprovalPreview } from '../../../src/shared/ipc-channels'
import type { AuditEntry } from '../../../src/shared/agent-types'

interface Harness {
  readonly queue: ApprovalQueue
  readonly audit: AuditEntry[]
}

function makeHarness(): Harness {
  const audit: AuditEntry[] = []
  const queue = new ApprovalQueue({
    git: {
      isRepo: () => true,
      diff: () => '',
      commitApproved: () => ({ ok: true, sha: 'abc123' }),
      discard: async () => ({ ok: true }),
      ignoredUntracked: () => []
    },
    audit: { log: (entry) => audit.push(entry) },
    getRoot: () => '/workspace',
    notify: () => {}
  })
  // Production wiring (machina-native-agent.setNativeHoldQueueProvider): a
  // settled hold releases its mirror row.
  setHoldSettledListener((toolUseId, accepted) => releaseNativeHold(queue, toolUseId, accepted))
  return { queue, audit }
}

const writePreview: AgentNativeApprovalPreview = {
  approvalKind: 'write_note',
  preview: { path: 'notes/idea.md', content: 'hello world', created: true }
}

const editPreview: AgentNativeApprovalPreview = {
  approvalKind: 'edit_note',
  preview: { path: 'notes/idea.md', find: 'old', replace: 'new' }
}

function releasedEntries(audit: readonly AuditEntry[]): AuditEntry[] {
  return audit.filter((e) => e.tool === 'approvals:hold-released')
}

beforeEach(() => {
  resetNativeHoldMirror()
  setHoldSettledListener(null)
})

describe('mirrorNativeHold', () => {
  it('surfaces a hold as a gate-confirm queue row with honest copy', () => {
    const h = makeHarness()
    void awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)

    const item = h.queue.list()[0]
    expect(item?.kind).toBe('gate-confirm')
    expect(item?.agentId).toBe('write_note')
    expect(item?.threadId).toBe('th-1')
    expect(item?.paths).toEqual(['notes/idea.md'])
    expect(item?.diff).toBe('hello world')
    expect(item?.description).toContain('awaiting your confirmation')
    expect(item?.description).not.toMatch(/block|prevent/i)
    clearApproval('tu1')
  })

  it('edit holds preview as a find/replace diff', () => {
    const h = makeHarness()
    void awaitApproval('tu-e')
    mirrorNativeHold(h.queue, 'tu-e', 'th-1', editPreview, decideApproval)

    expect(h.queue.list()[0]?.diff).toBe('- old\n+ new')
    clearApproval('tu-e')
  })

  it('a duplicate emit for the same toolUseId never doubles the row', () => {
    const h = makeHarness()
    void awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)

    expect(h.queue.list()).toHaveLength(1)
    clearApproval('tu1')
  })
})

describe('single resolution authority (double-resolve safety)', () => {
  it('tray approve resolves the hold exactly once; a late chat-card decision is a no-op', async () => {
    const h = makeHarness()
    const decision = awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)
    const id = h.queue.list()[0]?.id ?? ''

    const result = await h.queue.resolve(id, true)

    expect(result).toEqual({ ok: true })
    await expect(decision).resolves.toEqual({ accept: true, rejectReason: undefined })
    expect(h.queue.list()).toEqual([])
    // The settle listener released an already-removed row: no second audit
    // path, no zombie mapping.
    expect(releasedEntries(h.audit)).toHaveLength(0)
    expect(h.audit.filter((e) => e.tool === 'approvals:resolve')).toHaveLength(1)

    // Late chat-card decision: the resolver is gone — nothing double-fires.
    decideApproval('tu1', false, 'late click')
    expect(h.queue.list()).toEqual([])
  })

  it('tray reject denies the hold with the queue reason', async () => {
    const h = makeHarness()
    const decision = awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)
    const id = h.queue.list()[0]?.id ?? ''

    await h.queue.resolve(id, false)

    await expect(decision).resolves.toEqual({
      accept: false,
      rejectReason: 'User denied via approvals queue'
    })
    expect(h.queue.list()).toEqual([])
  })

  it('chat-card decision removes the mirror row; a late tray resolve is unknown-change', async () => {
    const h = makeHarness()
    const decision = awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)
    const id = h.queue.list()[0]?.id ?? ''

    decideApproval('tu1', true)

    await expect(decision).resolves.toEqual({ accept: true, rejectReason: undefined })
    expect(h.queue.list()).toEqual([])
    const released = releasedEntries(h.audit)
    expect(released).toHaveLength(1)
    expect(released[0].decision).toBe('allowed')

    // Late tray click on the vanished row: structured refusal, no decision.
    const late = await h.queue.resolve(id, false)
    expect(late).toEqual({ ok: false, reason: 'unknown-change' })
  })

  it('run abort (clearApproval) denies the hold and removes the mirror row', async () => {
    const h = makeHarness()
    const decision = awaitApproval('tu1')
    mirrorNativeHold(h.queue, 'tu1', 'th-1', writePreview, decideApproval)

    clearApproval('tu1', 'run aborted')

    await expect(decision).resolves.toEqual({ accept: false, rejectReason: 'run aborted' })
    expect(h.queue.list()).toEqual([])
    expect(releasedEntries(h.audit)[0]?.decision).toBe('denied')
  })

  it('holds are never serialized (gate-confirm pinned invariant)', () => {
    const persisted: unknown[][] = []
    const queue = new ApprovalQueue({
      git: {
        isRepo: () => true,
        diff: () => '',
        commitApproved: () => ({ ok: true }),
        discard: async () => ({ ok: true }),
        ignoredUntracked: () => []
      },
      audit: { log: () => {} },
      getRoot: () => '/workspace',
      notify: () => {},
      persist: (items) => persisted.push([...items])
    })
    void awaitApproval('tu1')
    mirrorNativeHold(queue, 'tu1', 'th-1', writePreview, decideApproval)

    expect(persisted.flat()).toEqual([])
    clearApproval('tu1')
  })
})

describe('production wiring registration', () => {
  it('setNativeHoldQueueProvider registers the settle listener against the provided queue', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: { getPath: () => '/tmp' },
      safeStorage: { isEncryptionAvailable: () => false },
      ipcMain: { handle: () => {} },
      BrowserWindow: class {}
    }))
    const agent = await import('../../../src/main/services/machina-native-agent')
    const ctx = await import('../../../src/main/services/machina-native-tools/context')
    const mirror = await import('../../../src/main/services/machina-native-tools/queue-mirror')
    const removed: Array<[string, boolean]> = []
    const fakeQueue = {
      enqueueGateHold: () => 'gh_1',
      removeGateHold: (id: string, accepted: boolean) => {
        removed.push([id, accepted])
        return true
      }
    }
    agent.setNativeHoldQueueProvider(() => fakeQueue)

    void ctx.awaitApproval('tu-wire')
    mirror.mirrorNativeHold(fakeQueue, 'tu-wire', 'th-1', writePreview, ctx.decideApproval)
    ctx.decideApproval('tu-wire', false, 'nope')

    expect(removed).toEqual([['gh_1', false]])
    vi.doUnmock('electron')
  })
})
