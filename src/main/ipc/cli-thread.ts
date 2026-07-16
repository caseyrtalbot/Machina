import { join } from 'node:path'
import { app } from 'electron'
import type { AgentIdentity } from '@shared/agent-identity'
import type { AdapterId } from '@shared/session-types'
import {
  ADAPTERS,
  identityForAdapter,
  resolveModelPick,
  validateRawInvocationTemplate
} from '@shared/agent-adapters'
import { SAFE_ID_RE } from '@shared/git-types'
import type { IpcRequest } from '@shared/ipc-channels'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import {
  CliThreadSpawner,
  isCliAgentIdentity,
  specIdForIdentity
} from '../services/cli-thread-spawner'
import { waitForFirstBlock } from '../services/shell-readiness'
import { ThreadStorage } from '../services/thread-storage'
import { AuditLogger } from '../services/audit-logger'
import {
  getCliTurnRegistry,
  setPtyAliveProbe,
  setTurnStartedListener,
  type TurnStartedInfo
} from '../services/cli-turn-registry'
import { getHarnessRunRegistry, type HarnessBinding } from '../services/harness-run-registry'
import {
  getAgentCircuitBreaker,
  setBreakerEmit,
  setBreakerKillCallback,
  type AgentCircuitBreaker
} from '../services/agent-circuit-breaker'
import type { HarnessBudgets } from '@shared/harness-types'
import { getCliAgentThreadBridge, getShellService } from './shell'
import { getApprovalsNotifier } from '../services/approvals-notifier'

let spawner: CliThreadSpawner | null = null

function getSpawner(): CliThreadSpawner {
  if (!spawner) {
    spawner = new CliThreadSpawner({
      shellService: getShellService(),
      bridge: getCliAgentThreadBridge(),
      // Gate-parity attribution (step 3): turn windows open on send, close on
      // block completion (wired in ipc/shell.ts), drop on thread close.
      registry: getCliTurnRegistry(),
      // Two-projection view (step 4): a spawn-on-demand respawn rebinds the
      // thread to a fresh PTY the renderer never saw a spawn response for —
      // broadcast it so the cli-session-store stays the single authority.
      onSessionChanged: (threadId, sessionId) => {
        const window = getMainWindow()
        if (window) typedSend(window, 'cli-thread:session-changed', { threadId, sessionId })
      },
      // Phase-1 step-6 lost-reply guard, main-side (P3 step 4): a fresh
      // spawn-on-demand PTY is never typed into before its first block
      // (shell prompt) appears; timeout/exit still sends (bounded best-effort).
      waitForSessionReady: (sid) => waitForFirstBlock(sid)
    })
    // Late-bound to break the shell.ts ↔ cli-thread.ts cycle: the registry's
    // degraded-mode window is "this thread's PTY is still alive".
    const bound = spawner
    setPtyAliveProbe((threadId) => bound.hasLiveSession(threadId))
    // Circuit-breaker kill path (step 6, contracts §5 v1.2.6): the existing
    // hard-kill — PTY killed, turn window dropped with zero linger. Same
    // late-bound pattern; the breaker module never imports the spawner.
    setBreakerKillCallback((threadId) => bound.close(threadId))
  }
  return spawner
}

/**
 * Audit label for a dispatch's entry point (Phase 3 step 4, contracts §4
 * v1.3.3): unattended dispatches must not masquerade as renderer turns in the
 * audit trail. Step 5's scheduler extends this union with its own literal.
 */
export type DispatchOrigin = 'cli-thread:input' | 'cli-thread:test-dispatch'

let auditLogger: AuditLogger | null = null

/**
 * Lazy audit singleton for rejected model picks and attribution mismatches.
 * Same location as the approvals-queue logger (ipc/git.ts): `userData/audit`
 * — outside any workspace watch root, so audit writes never self-trigger the
 * watcher. AuditLogger appends, so parallel instances on the same dir are safe.
 */
function getCliAuditLogger(): AuditLogger {
  if (auditLogger === null) {
    auditLogger = new AuditLogger(join(app.getPath('userData'), 'audit'))
  }
  return auditLogger
}

/**
 * Model-flag trust rule at the IPC boundary (workstation Phase 2 step 1).
 * A model is forwarded to the spawner ONLY when `resolveModelPick` resolves
 * it as an explicit pick: roster membership in `adapter.models` plus the
 * conservative charset regex. Absent, unknown, or the persisted
 * `DEFAULT_NATIVE_MODEL` filler (every pre-step-1 CLI thread carries it) ⇒
 * `undefined` — the adapter default, no flag. An explicit-but-rejected pick
 * additionally writes an audit note; the spawn/input itself still proceeds.
 * Exported for handler-level tests.
 */
export function resolveRequestedModel(
  channel: 'cli-thread:spawn' | DispatchOrigin,
  identity: AgentIdentity,
  requested: string | undefined,
  audit: Pick<AuditLogger, 'log'>
): string | undefined {
  // Non-CLI identities are rejected by the spawner itself; no model applies.
  if (!isCliAgentIdentity(identity)) return undefined
  const adapter = ADAPTERS[specIdForIdentity(identity) as AdapterId]
  const pick = resolveModelPick(adapter, requested)
  if (pick.kind === 'explicit') return pick.model
  if (pick.kind === 'invalid') {
    audit.log({
      ts: new Date().toISOString(),
      tool: channel,
      args: { identity, requestedModel: pick.requested },
      affectedPaths: [],
      decision: 'denied',
      error: 'model pick rejected (not in adapter roster or unsafe charset); adapter default used'
    })
  }
  return undefined
}

/**
 * Attribution trust rule at the IPC boundary (workstation Phase 2 step 3,
 * contracts §4 v1.2.2). Every spawn/input checks the thread's main binding,
 * even when renderer agentId is absent: truly unbound threads remain clean
 * ad-hoc turns, while a modern binding recovers its authoritative slug and
 * adapter. A malformed, stale, legacy-adapter-less, unbound-forwarded, or
 * registry-unresolvable value degrades to adapter attribution and tags the
 * turn suspect. A known binding adapter that does not map exactly to the
 * requested CLI identity fails closed.
 * `ensureRootReady` runs the one-time trust-on-upgrade backfill first, so the
 * first post-relaunch turn of a legacy thread never degrades falsely.
 * Exported for handler-level tests.
 */
export async function resolveRequestedAgentId(
  channel: 'cli-thread:spawn' | DispatchOrigin,
  threadId: string,
  cwd: string,
  requested: string | undefined,
  registry: {
    ensureRootReady(root: string): Promise<void>
    get(root: string, threadId: string): HarnessBinding | undefined
  },
  audit: Pick<AuditLogger, 'log'>,
  identity: AgentIdentity
): Promise<{
  agentId: string | undefined
  attributionSuspect: boolean
  invocationTemplate?: string
  blocked?: true
}> {
  const degrade = (
    reason:
      | 'malformed'
      | 'binding-mismatch'
      | 'unbound-thread'
      | 'registry-error'
      | 'adapter-unknown',
    extra: Readonly<Record<string, unknown>> = {}
  ): { agentId: undefined; attributionSuspect: true } => {
    audit.log({
      ts: new Date().toISOString(),
      tool: 'cli-agent:attribution-mismatch',
      args: { channel, threadId, requested, reason, ...extra },
      affectedPaths: [],
      decision: 'denied',
      error: `agentId failed binding validation (${reason}); adapter identity used`
    })
    return { agentId: undefined, attributionSuspect: true }
  }
  let binding: HarnessBinding | undefined
  try {
    await registry.ensureRootReady(cwd)
    binding = registry.get(cwd, threadId)
  } catch (err) {
    // A throwing registry (backfill scan over the tamperable threads dir,
    // ENOSPC on the mirror) degrades like any other validation failure —
    // never hard-fails the turn.
    return degrade('registry-error', { error: String(err) })
  }
  // Adapter authority is thread-bound, so enforce it before trusting (or
  // degrading) any renderer-forwarded slug. A stale/malformed slug must not
  // become a route around a modern raw↔structured adapter lock.
  if (binding?.adapter !== undefined) {
    const boundIdentity = identityForAdapter(binding.adapter)
    if (boundIdentity !== identity) {
      audit.log({
        ts: new Date().toISOString(),
        tool: 'cli-agent:attribution-mismatch',
        args: {
          channel,
          threadId,
          requested,
          reason: 'adapter-mismatch',
          boundAdapter: binding.adapter,
          boundIdentity,
          requestedIdentity: identity
        },
        affectedPaths: [],
        decision: 'denied',
        error: 'requested CLI identity does not match the harness binding adapter; turn blocked'
      })
      return { agentId: undefined, attributionSuspect: true, blocked: true }
    }
  }
  if (requested === undefined) {
    if (binding === undefined) return { agentId: undefined, attributionSuspect: false }
    if (binding.adapter === undefined) {
      return degrade('adapter-unknown', { boundSlug: binding.slug })
    }
    const rawTemplate =
      binding.adapter === 'raw'
        ? validateRawInvocationTemplate(binding.invocationTemplate)
        : { ok: false as const }
    return {
      agentId: binding.slug,
      attributionSuspect: false,
      ...(rawTemplate.ok ? { invocationTemplate: rawTemplate.value } : {})
    }
  }
  if (!SAFE_ID_RE.test(requested)) return degrade('malformed')
  if (binding === undefined) return degrade('unbound-thread')
  if (binding.slug !== requested) return degrade('binding-mismatch', { boundSlug: binding.slug })
  if (binding.adapter === undefined) {
    // Trust-on-upgrade and pre-step-8 bindings have no durable adapter fact.
    // Keep the ad-hoc turn usable, but never attribute it to the harness slug.
    return degrade('adapter-unknown', { boundSlug: binding.slug })
  }
  const rawTemplate =
    binding.adapter === 'raw'
      ? validateRawInvocationTemplate(binding.invocationTemplate)
      : { ok: false as const }
  return {
    agentId: requested,
    attributionSuspect: false,
    ...(rawTemplate.ok ? { invocationTemplate: rawTemplate.value } : {})
  }
}

/**
 * maxTurns budget check on every turn open (step 6, contracts §5 v1.2.6).
 * Resets the thread's breaker episode first (an explicit user send is
 * re-engagement), then trips on breach: invocationCount is the registry's
 * per-thread total INCLUDING this send, so budget N allows exactly N
 * invocations and the N+1th trips. Threads with no bound budgets snapshot
 * (ad-hoc, pre-step-6 bindings, backfills) are never budget-tripped.
 * Exported for handler-level tests.
 */
export function checkMaxTurnsOnTurnStarted(
  info: TurnStartedInfo,
  budgetFor: (cwd: string, threadId: string) => HarnessBudgets | undefined,
  breaker: Pick<AgentCircuitBreaker, 'noteTurnStarted' | 'noteMaxTurns'>
): void {
  breaker.noteTurnStarted({ threadId: info.threadId, agentId: info.agentId })
  const budgets = budgetFor(info.cwd, info.threadId)
  if (budgets !== undefined && info.invocationCount > budgets.maxTurns) {
    breaker.noteMaxTurns({
      threadId: info.threadId,
      agentId: info.agentId,
      invocationCount: info.invocationCount,
      maxTurns: budgets.maxTurns
    })
  }
}

/**
 * Per-thread dispatch serialization (Phase 3 step 4 review hardening): two
 * overlapping dispatches for one thread — a scheduler/test-channel turn
 * concurrent with a renderer turn (the renderer's inFlight guard is
 * renderer-side only) — would otherwise interleave: the second sees the
 * first's fresh PTY as live, sends ahead of it into a not-yet-ready shell,
 * and overwrites the spawner's shared per-thread cwd/agent/model maps and
 * the registry's current turn window mid-flight, corrupting attribution.
 * One turn per thread at a time, FIFO; distinct threads stay concurrent.
 */
const dispatchQueueByThread = new Map<string, Promise<unknown>>()

/**
 * Full dispatch body for one CLI-thread turn (Phase 3 step 4) — the single
 * implementation behind 'cli-thread:input' and every future main-originated
 * caller (dev-gated test channel, step 5+ scheduler). Persists the user
 * message main-side FIRST (persistence-authority cutover, contracts §4
 * v1.3.3), then runs the identical validation chain the IPC boundary always
 * ran. Turn windows / budgets / breaker / approvals engage automatically via
 * registry.turnStarted inside the spawner, so no caller can bypass the trust
 * boundary. `origin` labels the audit trail; the spawner singleton stays
 * module-private. Serialized per threadId (see dispatchQueueByThread).
 */
export function dispatchAgentTurn(
  args: IpcRequest<'cli-thread:input'>,
  origin: DispatchOrigin = 'cli-thread:input'
): Promise<{ ok: boolean }> {
  const key = args.threadId
  const prev = dispatchQueueByThread.get(key) ?? Promise.resolve()
  const run = prev.then(
    () => runDispatch(args, origin),
    () => runDispatch(args, origin)
  )
  // Settled shadow in the map (thread-write-queue pattern): a rejecting
  // dispatch surfaces to its own caller only, never as a tail rejection.
  const entry: Promise<void> = run
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      if (dispatchQueueByThread.get(key) === entry) dispatchQueueByThread.delete(key)
    })
  dispatchQueueByThread.set(key, entry)
  return run
}

async function runDispatch(
  args: IpcRequest<'cli-thread:input'>,
  origin: DispatchOrigin
): Promise<{ ok: boolean }> {
  const { threadId, identity, text, cwd, agentId, model } = args
  // User-message append BEFORE validation: refused turns keep today's disk
  // outcome (the renderer used to save the user message before dispatching),
  // and the message is durable before turnStarted opens. A missing thread
  // file (deleted/archived) fails the turn closed — no ghost turn.
  const appended = await new ThreadStorage(cwd).appendMessage(threadId, {
    role: 'user',
    body: text,
    sentAt: new Date().toISOString()
  })
  if (!appended) return { ok: false as const }
  const window = getMainWindow()
  if (window) typedSend(window, 'thread:changed', { root: cwd, threadId })
  // Spawn-on-demand: the spawner's threadId → sessionId map is in-memory,
  // so persisted threads have no session after a relaunch. The caller
  // supplies the per-turn cwd (workspace root) — main holds no vault-path
  // config read on this path.
  const attribution = await resolveRequestedAgentId(
    origin,
    threadId,
    cwd,
    agentId,
    getHarnessRunRegistry(),
    getCliAuditLogger(),
    identity
  )
  if (attribution.blocked === true) return { ok: false as const }
  const resolvedModel = resolveRequestedModel(origin, identity, model, getCliAuditLogger())
  return identity === 'cli-raw'
    ? getSpawner().input(
        threadId,
        identity,
        text,
        cwd,
        attribution.agentId,
        resolvedModel,
        attribution.attributionSuspect,
        attribution.invocationTemplate
      )
    : getSpawner().input(
        threadId,
        identity,
        text,
        cwd,
        attribution.agentId,
        resolvedModel,
        attribution.attributionSuspect
      )
}

export function registerCliThreadIpc(): void {
  // Breaker wiring (step 6). The check is deferred past the send ON PURPOSE:
  // turnStarted runs synchronously inside sendUserMessage BEFORE the PTY
  // write, and a synchronous maxTurns kill would close the session out from
  // under the in-flight send — the invocation goes out, then the PTY dies.
  // (The await below always yields at least one microtask.)
  //
  // v1.2.7 (post-merge review): the bindings mirror is in-memory and
  // lazily loaded, and NOTHING on the no-agentId-forwarded path loaded it —
  // after a relaunch with stripped frontmatter, budgets silently
  // disengaged. Load it here on EVERY turn open. Degrade-not-fail stands: a
  // throwing registry leaves the lookup unbound (default threshold, no
  // maxTurns) and the turn is never blocked; noteTurnStarted still resets
  // the episode either way.
  setTurnStartedListener((info) => {
    void (async () => {
      try {
        await getHarnessRunRegistry().ensureRootReady(info.cwd)
      } catch {
        // Registry failure (backfill scan, mirror persist) — enforcement
        // degrades to unbound for this turn; never a blocked or killed turn.
      }
      checkMaxTurnsOnTurnStarted(
        info,
        (cwd, threadId) => getHarnessRunRegistry().get(cwd, threadId)?.budgets,
        getAgentCircuitBreaker()
      )
    })()
  })
  setBreakerEmit((event) => {
    const window = getMainWindow()
    if (window) typedSend(window, 'agent:breaker-tripped', event)
    // Phase 3 step 2 (contracts §4 v1.3.1): breaker trips ALWAYS notify —
    // safety attention class, never focus-suppressed.
    getApprovalsNotifier().notifyBreakerTripped(event)
  })

  typedHandle('cli-thread:spawn', async ({ threadId, identity, cwd, agentId, model }) => {
    const attribution = await resolveRequestedAgentId(
      'cli-thread:spawn',
      threadId,
      cwd,
      agentId,
      getHarnessRunRegistry(),
      getCliAuditLogger(),
      identity
    )
    if (attribution.blocked === true) {
      return { ok: false as const, error: 'harness adapter identity mismatch' }
    }
    const resolvedModel = resolveRequestedModel(
      'cli-thread:spawn',
      identity,
      model,
      getCliAuditLogger()
    )
    return identity === 'cli-raw'
      ? getSpawner().spawn(
          threadId,
          identity,
          cwd,
          attribution.agentId,
          resolvedModel,
          attribution.attributionSuspect,
          attribution.invocationTemplate
        )
      : getSpawner().spawn(
          threadId,
          identity,
          cwd,
          attribution.agentId,
          resolvedModel,
          attribution.attributionSuspect
        )
  })

  typedHandle('cli-thread:input', async (args) => dispatchAgentTurn(args))

  typedHandle('cli-thread:close', async ({ threadId }) => {
    getSpawner().close(threadId)
  })

  typedHandle('cli-thread:cancel', async ({ threadId }) => {
    const ok = getSpawner().cancel(threadId)
    return { ok }
  })

  // Two-projection view (step 4): pull mirror of the spawner's binding for
  // late subscribers. The spawner map is the main-side authority; `live` is
  // the same PTY-alive probe the turn registry uses.
  typedHandle('cli-thread:get-session', async ({ threadId }) => {
    const spawner = getSpawner()
    const sessionId = spawner.getSessionId(threadId)
    if (sessionId === undefined) return null
    return { sessionId, live: spawner.hasLiveSession(threadId) }
  })

  // Circuit breaker pull mirror (step 6, contracts §5/§6 v1.2.6): currently
  // tripped threads + signal-source honesty, for late subscribers (tray
  // notice rows, kill-switch chip on boot).
  typedHandle('agent:breaker-status', async () => {
    return getAgentCircuitBreaker().status()
  })

  // E2E-only dispatch vehicle (P3 step 4): the built-app unattended probe
  // cannot reach dispatchAgentTurn through Playwright's app.evaluate
  // (electron namespace only), so a double-locked handler exposes it. Never
  // registered in a packaged build; ipcMain.invoke on an unregistered
  // channel rejects. The origin keeps its audit entries distinguishable
  // from renderer turns.
  if (!app.isPackaged && process.env['MACHINA_E2E'] === '1') {
    typedHandle('cli-thread:test-dispatch', async (args) =>
      dispatchAgentTurn(args, 'cli-thread:test-dispatch')
    )
  }
}
