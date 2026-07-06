import { join } from 'node:path'
import { app } from 'electron'
import type { AgentIdentity } from '@shared/agent-identity'
import type { AdapterId } from '@shared/session-types'
import { ADAPTERS, resolveModelPick } from '@shared/agent-adapters'
import { typedHandle } from '../typed-ipc'
import {
  CliThreadSpawner,
  isCliAgentIdentity,
  specIdForIdentity
} from '../services/cli-thread-spawner'
import { AuditLogger } from '../services/audit-logger'
import { getCliTurnRegistry, setPtyAliveProbe } from '../services/cli-turn-registry'
import { getCliAgentThreadBridge, getShellService } from './shell'

let spawner: CliThreadSpawner | null = null

function getSpawner(): CliThreadSpawner {
  if (!spawner) {
    spawner = new CliThreadSpawner({
      shellService: getShellService(),
      bridge: getCliAgentThreadBridge(),
      // Gate-parity attribution (step 3): turn windows open on send, close on
      // block completion (wired in ipc/shell.ts), drop on thread close.
      registry: getCliTurnRegistry()
    })
    // Late-bound to break the shell.ts ↔ cli-thread.ts cycle: the registry's
    // degraded-mode window is "this thread's PTY is still alive".
    const bound = spawner
    setPtyAliveProbe((threadId) => bound.hasLiveSession(threadId))
  }
  return spawner
}

let auditLogger: AuditLogger | null = null

/**
 * Lazy audit singleton for rejected model picks. Same location as the
 * approvals-queue logger (ipc/git.ts): `userData/audit` — outside any
 * workspace watch root, so audit writes never self-trigger the watcher.
 * AuditLogger appends, so parallel instances on the same dir are safe.
 */
function getModelAuditLogger(): AuditLogger {
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

export function registerCliThreadIpc(): void {
  typedHandle('cli-thread:spawn', async ({ threadId, identity, cwd, agentId, model }) => {
    return getSpawner().spawn(
      threadId,
      identity,
      cwd,
      agentId,
      resolveRequestedModel('cli-thread:spawn', identity, model, getModelAuditLogger())
    )
  })

  typedHandle('cli-thread:input', async ({ threadId, identity, text, cwd, agentId, model }) => {
    // Spawn-on-demand: the spawner's threadId → sessionId map is in-memory,
    // so persisted threads have no session after a relaunch. The renderer
    // supplies the per-turn cwd (workspace root) — main holds no vault-path
    // config read on this path.
    return getSpawner().input(
      threadId,
      identity,
      text,
      cwd,
      agentId,
      resolveRequestedModel('cli-thread:input', identity, model, getModelAuditLogger())
    )
  })

  typedHandle('cli-thread:close', async ({ threadId }) => {
    getSpawner().close(threadId)
  })

  typedHandle('cli-thread:cancel', async ({ threadId }) => {
    const ok = getSpawner().cancel(threadId)
    return { ok }
  })
}
