/**
 * Durable agent cost ledger (workstation Phase 3 step 5, contracts v1.3.4).
 *
 * Monotone lifetime USD spend per (workspace root, harness slug), mirrored to
 * userData — the persistence pattern is copied from HarnessRunRegistry
 * (lazy memoized load, degrade-not-fail decode, serialized persist chain,
 * atomic writes). Money is the one unrecoverable resource: a relaunch that
 * zeroed spend would be a silent budget refill, so the mirror survives app
 * restarts and there is deliberately NO reset API. Step 6's LoopRegistry
 * consumes baseline-and-delta: snapshot `spendFor(root, slug)` at arm time
 * and disarm when `current − armSnapshot > maxSpendUsd` — append-only, no
 * windowing semantics, no step-6 decision pre-empted.
 *
 * Semantics:
 *  - `spendFor` returns undefined for a never-observed key — NEVER 0: absence
 *    of observation must not read as "spent nothing" (flagged-not-zeroed).
 *  - Corrupt-mirror load degrades to empty but logs ONE audit entry — a
 *    corrupt money mirror is a silent budget-refill channel (deliberately
 *    stricter than HarnessRunRegistry's silent degrade; recorded deviation).
 *  - Accepted residual: a hard SIGKILL can lose at-most-in-flight increments.
 *    Undercount is the failure direction; the quit-time `flush()` in
 *    main/index.ts closes the coordinated-quit path.
 */
import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AuditEntry } from '../../shared/agent-types'
import { atomicWrite } from '../utils/atomic-write'
import { AuditLogger } from './audit-logger'

interface CostLedgerFileShape {
  readonly version: 1
  /** `${root}\0${slug}` → cumulative USD (NUL delimiter — impossible in a
   *  POSIX path or a validated harness slug, so keys never collide). */
  readonly spend: Readonly<Record<string, number>>
}

export interface AgentCostLedgerDeps {
  /** Persisted JSON mirror location (userData in production). */
  readonly filePath: string
  /** One entry on corrupt-mirror load — see the module doc. */
  readonly audit?: { log(entry: AuditEntry): void }
}

function spendKey(root: string, slug: string): string {
  return `${root}\0${slug}`
}

export class AgentCostLedger {
  private spend: Readonly<Record<string, number>> = {}
  /** Lazy, memoized: every public entry point awaits the same load. */
  private loadPromise: Promise<void> | null = null
  /** Tail of the serialized persist chain — see persist(). */
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly deps: AgentCostLedgerDeps) {}

  load(): Promise<void> {
    if (this.loadPromise === null) {
      this.loadPromise = this.loadFromDisk()
    }
    return this.loadPromise
  }

  /** Add an observed spend delta and chain a persist. Monotone: non-finite or
   *  negative deltas are dropped (a negative add would decrement money). */
  async recordSpend(root: string, slug: string, usd: number): Promise<void> {
    if (!Number.isFinite(usd) || usd < 0) return
    await this.load()
    const key = spendKey(root, slug)
    this.spend = { ...this.spend, [key]: (this.spend[key] ?? 0) + usd }
    await this.persist()
  }

  /** Lifetime observed-spend floor, or undefined for a never-observed key —
   *  NEVER 0. Reads in-memory state only; callers await `load()` first. */
  spendFor(root: string, slug: string): number | undefined {
    return this.spend[spendKey(root, slug)]
  }

  /** Await the persist chain (coordinated quit). Awaits load() first so a
   *  detached recordSpend still parked on the shared load has chained its
   *  persist before the chain is read (continuations on the memoized load
   *  run in call order, and recordSpend chains synchronously after it).
   *  Never rejects: individual persist failures already rejected to their
   *  recordSpend callers. */
  async flush(): Promise<void> {
    await this.load()
    return this.persistChain
  }

  // -- Internal --

  /** Corrupt/missing/wrong-version mirror ⇒ empty state — degrade-not-fail,
   *  never throw. Per-entry-tolerant: one bad value never rejects the file. */
  private async loadFromDisk(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.deps.filePath, 'utf8')
    } catch (err) {
      // ENOENT is the one benign shape: first run, nothing persisted yet.
      // Any OTHER read failure (EACCES, EISDIR, I/O error) hides a mirror
      // that may exist — degrading silently would reset the observed-spend
      // floor with no visibility, and the next recordSpend would durably
      // overwrite it (atomicWrite renames over an unreadable file). Audit
      // before degrading (v1.3.4 review fix).
      const code = (err as { code?: unknown } | null)?.code
      if (code !== 'ENOENT') this.auditCorrupt(`read failed: ${String(err)}`)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.auditCorrupt('unparseable JSON')
      return
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.auditCorrupt('not a JSON object')
      return
    }
    const shape = parsed as Partial<CostLedgerFileShape>
    // Unknown version: forward-compat skip, deliberately silent (a newer
    // build's file is not corruption — test-pinned design choice).
    if (shape.version !== 1) return
    if (typeof shape.spend !== 'object' || shape.spend === null) {
      // A CURRENT-version file with a garbled spend field is structural
      // corruption of the money mirror, not forward-compat (v1.3.4 review fix).
      this.auditCorrupt('spend field is not an object')
      return
    }
    const next: Record<string, number> = {}
    for (const [key, value] of Object.entries(shape.spend)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        next[key] = value
      }
    }
    this.spend = next
  }

  private auditCorrupt(detail: string): void {
    this.deps.audit?.log({
      ts: new Date().toISOString(),
      tool: 'agent-cost-ledger:corrupt-mirror',
      args: { filePath: this.deps.filePath },
      affectedPaths: [],
      decision: 'error',
      error: `cost ledger mirror unreadable (${detail}) — observed-spend floor reset to empty`
    })
  }

  /** Serialized persist chain, snapshot taken INSIDE the chained step (the
   *  HarnessRunRegistry shape): a failed write rejects its caller but never
   *  poisons later persists, and an older snapshot's rename can never land
   *  last and silently drop spend from the mirror. */
  private persist(): Promise<void> {
    const next = this.persistChain.then(() => this.doPersist())
    this.persistChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async doPersist(): Promise<void> {
    const shape: CostLedgerFileShape = { version: 1, spend: this.spend }
    await fs.mkdir(path.dirname(this.deps.filePath), { recursive: true })
    await atomicWrite(this.deps.filePath, JSON.stringify(shape, null, 2) + '\n')
  }
}

// ── Singleton wiring ─────────────────────────────────────────────────────

let singleton: AgentCostLedger | null = null

export function getAgentCostLedger(): AgentCostLedger {
  if (singleton === null) {
    singleton = new AgentCostLedger({
      filePath: path.join(app.getPath('userData'), 'agent-cost-ledger.json'),
      // Same location as the approvals-queue logger (ipc/git.ts): userData/
      // audit is outside any workspace watch root; AuditLogger appends, so
      // parallel instances on the same dir are safe.
      audit: new AuditLogger(path.join(app.getPath('userData'), 'audit'))
    })
  }
  return singleton
}
