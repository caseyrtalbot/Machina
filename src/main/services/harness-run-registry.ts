/**
 * Write-once harness↔thread binding registry (workstation contracts §4,
 * v1.2.2 — the attribution authority).
 *
 * `<TE_DIR>/threads` is watcher-ignored by design, so frontmatter `agent_id`
 * is tamperable and demoted to display-only. MAIN records a binding here only
 * after its own validation (composeHarnessRun), and every later spawn/input
 * validates the forwarded agentId against it. Invariants:
 *   1. write-once per (workspaceRoot, threadId): a re-record with the same
 *      slug is idempotent ok; a different slug is a structured error, never
 *      an overwrite;
 *   2. persisted under userData (outside any workspace watch root), atomic
 *      writes, corrupt/missing file loads as empty state — never throws;
 *   3. backfill is one-time PER WORKSPACE ROOT, persistently marked
 *      (`backfilledRoots`): pre-binding threads whose persisted agent_id
 *      names a real harness dir are trusted-on-upgrade (audited
 *      `cli-agent:binding-backfill`); after the mark, ANY forwarded agentId
 *      on an unbound thread degrades + flags. Re-running on every open would
 *      re-trust tampered frontmatter after each relaunch;
 *   4. bindings for deleted threads are not garbage-collected — harmless
 *      orphans; revert validation is trailer-based (contracts §4).
 *
 * Acknowledged residual: a user-level agent could theoretically reach
 * userData — same class as trailer forgery; accident containment, not a
 * boundary.
 */
import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TE_DIR, THREADS_DIR } from '../../shared/constants'
import { isReservedHarnessSlug, isValidHarnessSlug } from '../../shared/harness-types'
import type { AuditEntry } from '../../shared/agent-types'
import { atomicWrite } from '../utils/atomic-write'
import { AuditLogger } from './audit-logger'
import { ThreadStorage } from './thread-storage'

export interface HarnessBinding {
  readonly slug: string
  readonly workspaceRoot: string
  // Reserved for step 6 (budget stack): snapshot of harness budgets at bind time.
  readonly budgets?: undefined
}

export interface HarnessRunRegistryDeps {
  /** Persisted JSON mirror location (userData in production). */
  readonly filePath: string
  readonly audit: { log(entry: AuditEntry): void }
  /** Thread frontmatter agentIds for the backfill scan. */
  readonly listThreadAgentIds: (
    root: string
  ) => Promise<ReadonlyArray<{ threadId: string; agentId?: string }>>
  /** Realpath-checked: a symlinked agents dir must not validate backfills. */
  readonly harnessDirExists: (root: string, slug: string) => Promise<boolean>
}

interface RegistryFileShape {
  readonly version: 1
  readonly backfilledRoots: readonly string[]
  readonly bindings: Readonly<Record<string, HarnessBinding>>
}

/** NUL delimiter — impossible in a POSIX path or a threadId, so keys never collide. */
function bindingKey(workspaceRoot: string, threadId: string): string {
  return `${workspaceRoot}\0${threadId}`
}

export class HarnessRunRegistry {
  private readonly bindings = new Map<string, HarnessBinding>()
  private readonly backfilledRoots = new Set<string>()
  /** Lazy, memoized: every public entry point awaits the same load. */
  private loadPromise: Promise<void> | null = null
  /** In-flight backfills per root — concurrent spawn+input must not double-run. */
  private readonly backfillsInFlight = new Map<string, Promise<void>>()
  /** Tail of the serialized persist chain — see persist(). */
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly deps: HarnessRunRegistryDeps) {}

  /**
   * The thread's binding, or undefined. Reads in-memory state only — callers
   * await `ensureRootReady(root)` (or `record`) first, which loads the mirror.
   */
  get(workspaceRoot: string, threadId: string): HarnessBinding | undefined {
    return this.bindings.get(bindingKey(workspaceRoot, threadId))
  }

  /**
   * WRITE-ONCE record: an existing binding with the same slug is idempotent
   * ok; a different slug is an error — a binding is never overwritten.
   * Persists on every successful record.
   */
  async record(
    workspaceRoot: string,
    threadId: string,
    slug: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    await this.load()
    const key = bindingKey(workspaceRoot, threadId)
    const existing = this.bindings.get(key)
    if (existing !== undefined && existing.slug !== slug) {
      return {
        ok: false,
        error: `thread ${threadId} is already bound to harness "${existing.slug}" (bindings are write-once)`
      }
    }
    if (existing === undefined) {
      this.bindings.set(key, { slug, workspaceRoot })
    }
    await this.persist()
    return { ok: true }
  }

  /**
   * Load + one-time trust-on-upgrade backfill for `root`. Threads whose
   * persisted agentId is a valid harness slug naming an existing harness dir
   * get a binding (audited `cli-agent:binding-backfill`); threads whose
   * agentId names no harness dir get NO binding and will degrade + flag on
   * their next send. The root is marked backfilled — and persisted — even
   * when zero threads matched.
   */
  async ensureRootReady(root: string): Promise<void> {
    await this.load()
    if (this.backfilledRoots.has(root)) return
    const inFlight = this.backfillsInFlight.get(root)
    if (inFlight !== undefined) return inFlight
    const backfill = this.backfillRoot(root).finally(() => {
      this.backfillsInFlight.delete(root)
    })
    this.backfillsInFlight.set(root, backfill)
    return backfill
  }

  // -- Internal --

  private async backfillRoot(root: string): Promise<void> {
    const threads = await this.deps.listThreadAgentIds(root)
    for (const { threadId, agentId } of threads) {
      if (agentId === undefined || !isValidHarnessSlug(agentId)) continue
      // An agentId equal to an adapter identity (e.g. 'cli-claude') would be
      // indistinguishable from the degrade fallback in trailers — never bind it.
      if (isReservedHarnessSlug(agentId)) continue
      if (!(await this.deps.harnessDirExists(root, agentId))) continue
      const key = bindingKey(root, threadId)
      // Write-once holds through the backfill too: a binding recorded before
      // the scan (fresh harness run) is never overwritten by frontmatter.
      if (this.bindings.has(key)) continue
      this.bindings.set(key, { slug: agentId, workspaceRoot: root })
      this.deps.audit.log({
        ts: new Date().toISOString(),
        tool: 'cli-agent:binding-backfill',
        args: { threadId, slug: agentId, root },
        affectedPaths: [],
        decision: 'allowed'
      })
    }
    this.backfilledRoots.add(root)
    await this.persist()
  }

  private load(): Promise<void> {
    if (this.loadPromise === null) {
      this.loadPromise = this.loadFromDisk()
    }
    return this.loadPromise
  }

  /** Corrupt or missing mirror ⇒ empty state — degrade-not-fail, never throw. */
  private async loadFromDisk(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(this.deps.filePath, 'utf8'))
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const shape = parsed as Partial<RegistryFileShape>
    if (shape.version !== 1) return
    if (Array.isArray(shape.backfilledRoots)) {
      for (const root of shape.backfilledRoots) {
        if (typeof root === 'string') this.backfilledRoots.add(root)
      }
    }
    if (typeof shape.bindings === 'object' && shape.bindings !== null) {
      for (const [key, binding] of Object.entries(shape.bindings)) {
        if (
          typeof binding === 'object' &&
          binding !== null &&
          typeof binding.slug === 'string' &&
          typeof binding.workspaceRoot === 'string'
        ) {
          this.bindings.set(key, { slug: binding.slug, workspaceRoot: binding.workspaceRoot })
        }
      }
    }
  }

  /**
   * Overlapping persists (concurrent record(), or record alongside a
   * backfill) must not let an older snapshot's rename land last and silently
   * drop a binding from the mirror: writes are serialized through a chain and
   * the snapshot is taken INSIDE the chained step, so the final write always
   * carries the latest full state.
   */
  private persist(): Promise<void> {
    const next = this.persistChain.then(() => this.doPersist())
    // A failed write (ENOSPC) still rejects to the caller but must not
    // poison later persists.
    this.persistChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async doPersist(): Promise<void> {
    const shape: RegistryFileShape = {
      version: 1,
      backfilledRoots: [...this.backfilledRoots],
      bindings: Object.fromEntries(this.bindings)
    }
    await fs.mkdir(path.dirname(this.deps.filePath), { recursive: true })
    await atomicWrite(this.deps.filePath, JSON.stringify(shape, null, 2) + '\n')
  }
}

// ── Singleton wiring ─────────────────────────────────────────────────────

/**
 * Same realpath-equality refusal as harness-service invariant 4: a symlinked
 * <TE_DIR>/agents (or slug dir) must not validate a backfill — equality, not
 * containment, because an intra-root alias would still defeat the
 * literal-relative-path glob matcher.
 */
async function harnessDirExists(root: string, slug: string): Promise<boolean> {
  const dir = path.join(root, TE_DIR, 'agents', slug)
  try {
    const [realDir, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(root)])
    if (realDir !== path.join(realRoot, TE_DIR, 'agents', slug)) return false
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Per-file tolerance for the backfill scan: `<TE_DIR>/threads` is the
 * watcher-ignored tamper channel this registry defends, so one crafted or
 * corrupt file (unsafe basename, malformed frontmatter) must not reject the
 * whole scan — and with it every agentId-forwarding turn on the root. Bad
 * entries are skipped; those threads simply stay unbound and degrade + flag
 * on their next send.
 */
export async function listThreadAgentIdsTolerant(
  root: string
): Promise<ReadonlyArray<{ threadId: string; agentId?: string }>> {
  const storage = new ThreadStorage(root)
  let files: string[]
  try {
    files = (await fs.readdir(path.join(root, TE_DIR, THREADS_DIR))).filter((f) =>
      f.endsWith('.md')
    )
  } catch {
    return []
  }
  const out: Array<{ threadId: string; agentId?: string }> = []
  for (const file of files) {
    try {
      const t = await storage.readThread(file.slice(0, -'.md'.length))
      out.push({ threadId: t.id, agentId: t.agentId })
    } catch {
      // Undecodable or unsafely named — skipped, stays unbound.
    }
  }
  return out
}

let singleton: HarnessRunRegistry | null = null

export function getHarnessRunRegistry(): HarnessRunRegistry {
  if (singleton === null) {
    singleton = new HarnessRunRegistry({
      filePath: path.join(app.getPath('userData'), 'harness-bindings.json'),
      // Same location as the approvals-queue logger (ipc/git.ts): userData/audit
      // is outside any workspace watch root, and AuditLogger appends, so
      // parallel instances on the same dir are safe.
      audit: new AuditLogger(path.join(app.getPath('userData'), 'audit')),
      listThreadAgentIds: listThreadAgentIdsTolerant,
      harnessDirExists
    })
  }
  return singleton
}
