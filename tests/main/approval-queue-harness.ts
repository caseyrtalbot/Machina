/**
 * Shared fakes for the ApprovalQueue suites. Split out of
 * approval-queue.test.ts (Phase 3 step 2 review fix pass) so each suite stays
 * under the 800-line ceiling: core behaviors in approval-queue.test.ts;
 * v1.3.0 scope/persistence + real-git integration + v1.3.1 delta-notify and
 * gate-hold coverage in approval-queue-scope.test.ts.
 */
import { vi } from 'vitest'

import { ApprovalQueue } from '../../src/main/services/approval-queue'
import type { HitlConfirmOpts } from '../../src/main/services/hitl-gate'
import type { AuditEntry } from '../../src/shared/agent-types'
import type { GitOpResult, PendingChange } from '../../src/shared/git-types'
import type { ApprovalsAddedItem } from '../../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

export interface Harness {
  readonly queue: ApprovalQueue
  readonly audit: AuditEntry[]
  readonly notifications: number[]
  /** Every notify delta, in mutation order (v1.3.1: added items only). */
  readonly addedDeltas: ApprovalsAddedItem[][]
  /** Every persist-hook snapshot, in mutation order (cli-change items only). */
  readonly persisted: PendingChange[][]
  readonly git: {
    isRepo: ReturnType<typeof vi.fn>
    diff: ReturnType<typeof vi.fn>
    commitApproved: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    ignoredUntracked: ReturnType<typeof vi.fn>
  }
  setDiff(next: string): void
  setRoot(next: string | null): void
  setIgnoredUntracked(next: readonly string[]): void
}

export function makeHarness(opts: { isRepo?: boolean; root?: string | null } = {}): Harness {
  const audit: AuditEntry[] = []
  const notifications: number[] = []
  const addedDeltas: ApprovalsAddedItem[][] = []
  const persisted: PendingChange[][] = []
  let diffValue = 'diff-v1'
  let rootValue = opts.root !== undefined ? opts.root : '/workspace'
  let tick = 0
  let ignoredValue: readonly string[] = []
  const git = {
    isRepo: vi.fn((): boolean => opts.isRepo ?? true),
    diff: vi.fn((): string => diffValue),
    commitApproved: vi.fn((): GitOpResult => ({ ok: true, sha: 'abc123' })),
    discard: vi.fn(async (): Promise<GitOpResult> => ({ ok: true })),
    ignoredUntracked: vi.fn((): readonly string[] => ignoredValue)
  }
  const queue = new ApprovalQueue({
    git,
    audit: { log: (entry) => audit.push(entry) },
    getRoot: () => rootValue,
    notify: (pending, added) => {
      notifications.push(pending)
      addedDeltas.push([...added])
    },
    persist: (items) => persisted.push([...items]),
    now: () => new Date(1751000000000 + tick++ * 1000).toISOString()
  })
  return {
    queue,
    audit,
    notifications,
    addedDeltas,
    persisted,
    git,
    setDiff: (next) => {
      diffValue = next
    },
    setRoot: (next) => {
      rootValue = next
    },
    setIgnoredUntracked: (next) => {
      ignoredValue = next
    }
  }
}

/** recordWrites returns null only on the captured-root coalesce refusal (v1.3.0). */
export function mustRecord(change: PendingChange | null): PendingChange {
  if (change === null) throw new Error('recordWrites refused the batch')
  return change
}

export function recordTurn(h: Harness, turnId = 't1'): PendingChange {
  return mustRecord(
    h.queue.recordWrites({
      turnId,
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['a.txt']
    })
  )
}

export const GATE_OPTS: HitlConfirmOpts = {
  tool: 'vault.write_file',
  path: 'notes/idea.md',
  description: 'Write 120 bytes'
}

const NO_FLAGS = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  gateDegraded: false,
  attributionSuspect: false,
  forbidden: false
} as const

/** A persisted cli-change item as the disk mirror would hand it to rehydrate. */
export function persistedItem(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    id: 'pc_r1',
    kind: 'cli-change',
    threadId: 'th-1',
    agentId: 'fixer',
    paths: ['a.txt'],
    diff: 'diff-v1',
    capturedAt: '2026-07-14T00:00:00.000Z',
    revertible: true,
    flags: NO_FLAGS,
    capturedRoot: '/workspace',
    ...overrides
  }
}
