import { join } from 'node:path'
import { app } from 'electron'
import type { AgentIdentity } from '@shared/agent-identity'
import type { AdapterId } from '@shared/session-types'
import { ADAPTERS, resolveModelPick } from '@shared/agent-adapters'
import { SAFE_ID_RE } from '@shared/git-types'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import {
  CliThreadSpawner,
  isCliAgentIdentity,
  specIdForIdentity
} from '../services/cli-thread-spawner'
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
      }
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
  channel: 'cli-thread:spawn' | 'cli-thread:input',
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
 * contracts §4 v1.2.2). Degrade-not-fail: the turn ALWAYS proceeds. An absent
 * agentId is the unbound ad-hoc case — no lookup, no audit; the spawner
 * defaults to the adapter identity. A forwarded value must match the thread's
 * write-once binding: malformed, mismatched, forwarded on an unbound
 * thread, or unresolvable because the registry itself failed (backfill scan
 * or mirror persist threw) ⇒ fall back to adapter identity
 * (`agentId: undefined`), audit `cli-agent:attribution-mismatch`, and tag
 * the turn attributionSuspect.
 * `ensureRootReady` runs the one-time trust-on-upgrade backfill first, so the
 * first post-relaunch turn of a legacy thread never degrades falsely.
 * Exported for handler-level tests.
 */
export async function resolveRequestedAgentId(
  channel: 'cli-thread:spawn' | 'cli-thread:input',
  threadId: string,
  cwd: string,
  requested: string | undefined,
  registry: {
    ensureRootReady(root: string): Promise<void>
    get(root: string, threadId: string): HarnessBinding | undefined
  },
  audit: Pick<AuditLogger, 'log'>
): Promise<{ agentId: string | undefined; attributionSuspect: boolean }> {
  if (requested === undefined) return { agentId: undefined, attributionSuspect: false }
  const degrade = (
    reason: 'malformed' | 'binding-mismatch' | 'unbound-thread' | 'registry-error',
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
  if (!SAFE_ID_RE.test(requested)) return degrade('malformed')
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
  if (binding === undefined) return degrade('unbound-thread')
  if (binding.slug !== requested) return degrade('binding-mismatch', { boundSlug: binding.slug })
  return { agentId: requested, attributionSuspect: false }
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
  })

  typedHandle('cli-thread:spawn', async ({ threadId, identity, cwd, agentId, model }) => {
    const attribution = await resolveRequestedAgentId(
      'cli-thread:spawn',
      threadId,
      cwd,
      agentId,
      getHarnessRunRegistry(),
      getCliAuditLogger()
    )
    return getSpawner().spawn(
      threadId,
      identity,
      cwd,
      attribution.agentId,
      resolveRequestedModel('cli-thread:spawn', identity, model, getCliAuditLogger()),
      attribution.attributionSuspect
    )
  })

  typedHandle('cli-thread:input', async ({ threadId, identity, text, cwd, agentId, model }) => {
    // Spawn-on-demand: the spawner's threadId → sessionId map is in-memory,
    // so persisted threads have no session after a relaunch. The renderer
    // supplies the per-turn cwd (workspace root) — main holds no vault-path
    // config read on this path.
    const attribution = await resolveRequestedAgentId(
      'cli-thread:input',
      threadId,
      cwd,
      agentId,
      getHarnessRunRegistry(),
      getCliAuditLogger()
    )
    return getSpawner().input(
      threadId,
      identity,
      text,
      cwd,
      attribution.agentId,
      resolveRequestedModel('cli-thread:input', identity, model, getCliAuditLogger()),
      attribution.attributionSuspect
    )
  })

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
}
