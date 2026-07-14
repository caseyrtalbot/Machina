/**
 * Approval-queue disk mirror (workstation Phase 3 step 1, contracts §4 v1.3.0).
 *
 * Persists the queue's cli-change items under userData so captured-but-
 * unreviewed writes survive an app restart (the queue is multi-root and
 * genuinely global). Follows the HarnessRunRegistry file pattern: versioned
 * shape, atomic writes serialized through a chain, degrade-not-fail load —
 * a corrupt or missing mirror loads as empty state, never a throw. Rehydrated
 * items are re-validated by ApprovalQueue.rehydrate before they re-enter the
 * queue; this module is transport only.
 *
 * Gate-confirm items are NEVER serialized: they hold live Promise waiters,
 * and a rehydrated confirm would be an unanswerable zombie row resurrecting
 * the stale-click hazard remove-on-timeout exists to kill. Enforced at BOTH
 * ends: persist() filters them out, decode refuses the kind.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PendingChange, PendingChangeFlags } from '@shared/git-types'
import { atomicWrite } from '../utils/atomic-write'

interface QueueMirrorShape {
  readonly version: 1
  readonly items: readonly PendingChange[]
}

/**
 * Decode-level drop diagnostic (contracts §4 v1.3.0: drops are audited,
 * never silent). This module stays transport-only — the caller (ipc/git.ts)
 * writes the `approvals:rehydrate-drop` audit entries.
 */
export interface QueueMirrorDrop {
  /** The entry's id when one was readable, else 'unknown'. */
  readonly id: string
  readonly reason: 'gate-confirm-never-rehydrated' | 'malformed'
}

export interface QueueMirrorLoadResult {
  readonly items: readonly PendingChange[]
  readonly dropped: readonly QueueMirrorDrop[]
}

const FLAG_KEYS = [
  'highVelocity',
  'headMoved',
  'concurrentTurns',
  'degradedAttribution',
  'gateDegraded',
  'attributionSuspect',
  'forbidden'
] as const

function decodeFlags(value: unknown): PendingChangeFlags | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  for (const key of FLAG_KEYS) {
    if (typeof v[key] !== 'boolean') return undefined
  }
  return {
    highVelocity: v.highVelocity === true,
    headMoved: v.headMoved === true,
    concurrentTurns: v.concurrentTurns === true,
    degradedAttribution: v.degradedAttribution === true,
    gateDegraded: v.gateDegraded === true,
    attributionSuspect: v.attributionSuspect === true,
    forbidden: v.forbidden === true
  }
}

/**
 * Per-item tolerant decode: one malformed entry is dropped (with a reported
 * reason — never silently), never a load failure. `kind !== 'cli-change'`
 * (a tampered mirror smuggling a gate-confirm) is refused here as the second
 * half of the never-serialized rule. A missing/invalid capturedRoot decodes
 * as null — the queue's rehydrate then drops the item (conservative:
 * unverifiable ⇒ drop + audit).
 */
function decodeItem(value: unknown): PendingChange | QueueMirrorDrop {
  const drop = (v: Record<string, unknown> | null, reason: QueueMirrorDrop['reason']) =>
    ({ id: typeof v?.id === 'string' ? v.id : 'unknown', reason }) satisfies QueueMirrorDrop
  if (typeof value !== 'object' || value === null) return drop(null, 'malformed')
  const v = value as Record<string, unknown>
  if (v.kind === 'gate-confirm') return drop(v, 'gate-confirm-never-rehydrated')
  if (v.kind !== 'cli-change') return drop(v, 'malformed')
  if (typeof v.id !== 'string' || typeof v.threadId !== 'string' || typeof v.agentId !== 'string')
    return drop(v, 'malformed')
  if (!Array.isArray(v.paths) || !v.paths.every((p): p is string => typeof p === 'string'))
    return drop(v, 'malformed')
  if (typeof v.diff !== 'string' || typeof v.capturedAt !== 'string') return drop(v, 'malformed')
  if (typeof v.revertible !== 'boolean') return drop(v, 'malformed')
  const flags = decodeFlags(v.flags)
  if (flags === undefined) return drop(v, 'malformed')
  const capturedRoot = typeof v.capturedRoot === 'string' ? v.capturedRoot : null
  return {
    id: v.id,
    kind: 'cli-change',
    threadId: v.threadId,
    agentId: v.agentId,
    paths: [...v.paths],
    diff: v.diff,
    capturedAt: v.capturedAt,
    revertible: v.revertible,
    flags,
    capturedRoot,
    ...(typeof v.description === 'string' ? { description: v.description } : {})
  }
}

export class ApprovalQueuePersistence {
  /** Tail of the serialized persist chain — see persist(). */
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  /**
   * Corrupt or missing mirror ⇒ empty — degrade-not-fail, never a throw
   * (a missing file is the normal first run; whole-file corruption degrades
   * to empty per contracts §4). Per-ITEM decode failures are returned as
   * drop diagnostics so the caller can audit them — a smuggled gate-confirm
   * or malformed entry is dropped, never silently.
   */
  async load(): Promise<QueueMirrorLoadResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
    } catch {
      return { items: [], dropped: [] }
    }
    if (typeof parsed !== 'object' || parsed === null) return { items: [], dropped: [] }
    const shape = parsed as Partial<QueueMirrorShape>
    if (shape.version !== 1 || !Array.isArray(shape.items)) return { items: [], dropped: [] }
    const items: PendingChange[] = []
    const dropped: QueueMirrorDrop[] = []
    for (const raw of shape.items) {
      const decoded = decodeItem(raw)
      if ('reason' in decoded) dropped.push(decoded)
      else items.push(decoded)
    }
    return { items, dropped }
  }

  /**
   * Serialize the queue's cli-change snapshot. Writes are serialized through
   * a chain (the HarnessRunRegistry pattern) so an older snapshot's rename
   * can never land after a newer one; a failed write (ENOSPC) still rejects
   * to the caller but never poisons later persists. Gate-confirm items are
   * filtered out here even if a caller passes them — never serialized.
   */
  persist(items: readonly PendingChange[]): Promise<void> {
    const snapshot = items.filter((item) => item.kind === 'cli-change')
    const next = this.persistChain.then(() => this.doPersist(snapshot))
    this.persistChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async doPersist(items: readonly PendingChange[]): Promise<void> {
    const shape: QueueMirrorShape = { version: 1, items }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await atomicWrite(this.filePath, JSON.stringify(shape, null, 2) + '\n')
  }
}
