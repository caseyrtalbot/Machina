/**
 * CLI thread spawner (Phase 8 Task 8.2).
 *
 * Owns the per-thread shell PTY for `cli-claude` / `cli-codex` / `cli-gemini`
 * / `cli-raw` threads. Each user message becomes a one-shot non-interactive
 * invocation (`claude --print …` / `codex exec …`) written to the PTY, so the
 * existing shell-hook block protocol captures one Block per turn — which the
 * CliAgentThreadBridge converts into one ThreadMessage. Subsequent turns
 * resume the agent's own session (see `CliInvocationOptions` in
 * `@shared/session-types`).
 *
 * Invocation formatting is delegated to the adapter registry
 * (`@shared/agent-adapters`, workstation Phase 2 step 1) — the per-adapter
 * switch that used to live here moved there verbatim. The detector is
 * injected so the spawner stays trivially testable without shelling out.
 */

import type { AgentIdentity } from '@shared/agent-identity'
import type { CLIAgentInstallation } from '@shared/cli-agents'
import type { AdapterId, AgentAdapter } from '@shared/session-types'
import { ADAPTERS } from '@shared/agent-adapters'
import { sessionId as brandSessionId } from '@shared/types'
import type { ShellService } from './shell-service'
import type { CliAgentThreadBridge } from './cli-agent-thread-bridge'
import { detectInstalledAgents } from './cli-agent-detector'

const CLI_AGENT_IDENTITIES = ['cli-claude', 'cli-codex', 'cli-gemini', 'cli-raw'] as const
type CliAgentIdentity = (typeof CLI_AGENT_IDENTITIES)[number]

export function isCliAgentIdentity(value: string): value is CliAgentIdentity {
  return (CLI_AGENT_IDENTITIES as readonly string[]).includes(value)
}

/** Map AgentIdentity (`cli-claude`) to the registry id (`claude`). */
export function specIdForIdentity(identity: AgentIdentity): string {
  return identity.startsWith('cli-') ? identity.slice(4) : identity
}

/** Registry lookup: every CLI agent identity maps 1:1 onto an adapter. */
function adapterForIdentity(identity: CliAgentIdentity): AgentAdapter {
  return ADAPTERS[specIdForIdentity(identity) as AdapterId]
}

type SpawnResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly error: string }

/** The slice of CliTurnRegistry the spawner drives (workstation step 3). */
export interface SpawnerTurnRegistry {
  turnStarted(opts: {
    threadId: string
    agentId: string
    cwd: string
    attributionSuspect?: boolean
  }): unknown
  threadClosed(threadId: string): void
}

interface CliThreadSpawnerOptions {
  readonly shellService: ShellService
  readonly bridge: CliAgentThreadBridge
  readonly detect?: () => Promise<readonly CLIAgentInstallation[]>
  /** Optional so existing tests and callers stay valid; wired in ipc/cli-thread.ts. */
  readonly registry?: SpawnerTurnRegistry
  /**
   * Fired when a thread's turn lands in a FRESH PTY on the spawn-on-demand
   * respawn path inside `input()` (workstation Phase 2 step 4). The explicit
   * `spawn()` call already returns its sessionId in the IPC response, so the
   * event covers only the rebinding the renderer would otherwise never see.
   */
  readonly onSessionChanged?: (threadId: string, sessionId: string) => void
  /**
   * Main-side shell-readiness wait (workstation Phase 3 step 4): resolves true
   * once the fresh PTY's first block appears (its shell prompt has been
   * drawn), false on timeout or session exit. Awaited before EVERY send —
   * the live PTY may have been minted by an explicit `spawn()` or by a
   * concurrent dispatch whose wait is still pending, so gating only the
   * spawn-on-demand branch would type into a not-yet-ready shell. Already-
   * ready sessions resolve immediately. Optional so existing tests and
   * callers stay valid; wired in ipc/cli-thread.ts to
   * shell-readiness.waitForFirstBlock.
   */
  readonly waitForSessionReady?: (sessionId: string) => Promise<boolean>
}

export class CliThreadSpawner {
  /** threadId → sessionId of the bound PTY. */
  private readonly sessionByThread = new Map<string, string>()
  /**
   * Thread deletion is permanent for a spawner instance. Async detection may
   * finish after `close()`; this tombstone keeps that stale continuation from
   * creating a PTY or writing a command after the renderer has deleted it.
   */
  private readonly closedThreads = new Set<string>()
  /**
   * Identity that created the currently live PTY. A live thread may never be
   * retargeted to a different adapter: that would let one harness binding
   * write through another adapter's already-open shell.
   */
  private readonly identityByThread = new Map<string, CliAgentIdentity>()
  /**
   * Threads that already received at least one turn in this app run.
   * Deliberately not cleared on close(): conversation continuity outlives
   * the PTY (the next turn resumes the agent session in a fresh shell).
   * In-memory only — after an app relaunch the first turn starts a fresh
   * agent conversation even though the thread UI shows history.
   */
  private readonly turnsSent = new Set<string>()
  /** Per-thread cwd of the last spawn/input — the turn window's root. */
  private readonly cwdByThread = new Map<string, string>()
  /**
   * Per-thread harness slug (the step 6 seam). Absent → the turn's agentId
   * defaults to the adapter identity (`cli-claude` etc.).
   */
  private readonly agentIdByThread = new Map<string, string>()
  /**
   * Per-thread explicit model pick (workstation step 1). The value arrives
   * PRE-VALIDATED from the IPC boundary (`resolveModelPick`: roster
   * membership + charset) — this map and `formatInvocation` trust it as-is.
   * `undefined` means "adapter default": it CLEARS the stored pick, because
   * the IPC boundary resolves every request independently and forwarding
   * `undefined` is its way of saying "no flag this turn".
   */
  private readonly modelByThread = new Map<string, string>()
  /**
   * Main-resolved raw invocation template snapshotted in HarnessRunRegistry.
   * Every spawn/input request sets or clears this slot; renderer state is never
   * a source. Structured adapters never consult it.
   */
  private readonly invocationTemplateByThread = new Map<string, string>()
  /**
   * Per-thread attribution-suspect tag (contracts §4 v1.2.2). Arrives
   * PRE-RESOLVED from the IPC boundary (`resolveRequestedAgentId`) on every
   * spawn/input — suspect=false clears, so a thread is only tagged while its
   * latest request actually failed binding validation.
   */
  private readonly attributionSuspectByThread = new Map<string, boolean>()

  constructor(private readonly opts: CliThreadSpawnerOptions) {}

  async spawn(
    threadId: string,
    identity: AgentIdentity,
    cwd: string,
    agentId?: string,
    model?: string,
    attributionSuspect?: boolean,
    invocationTemplate?: string
  ): Promise<SpawnResult> {
    if (!isCliAgentIdentity(identity)) {
      return { ok: false, error: `not a CLI agent: ${identity}` }
    }
    if (this.closedThreads.has(threadId)) {
      return { ok: false, error: `thread ${threadId} is closed` }
    }
    if (this.hasLiveSession(threadId)) {
      const boundIdentity = this.identityByThread.get(threadId)
      if (boundIdentity !== identity) {
        return {
          ok: false,
          error: `thread ${threadId} already has a live ${boundIdentity ?? 'unknown'} session`
        }
      }
      this.cwdByThread.set(threadId, cwd)
      this.setAttribution(threadId, agentId, attributionSuspect)
      this.setModel(threadId, model)
      this.setInvocationTemplate(threadId, identity === 'cli-raw' ? invocationTemplate : undefined)
      return { ok: true, sessionId: this.sessionByThread.get(threadId)! }
    }
    // `cli-raw` has no binary to probe (RAW_AGENT_SPEC.alwaysAvailable): the
    // whole command line comes from an invocation template (OQ3), so the
    // installed-binary check is skipped — a raw session is a plain PTY.
    if (identity !== 'cli-raw') {
      const detect = this.opts.detect ?? detectInstalledAgents
      const installations = await detect()
      if (this.closedThreads.has(threadId)) {
        return { ok: false, error: `thread ${threadId} is closed` }
      }
      const specId = specIdForIdentity(identity)
      const inst = installations.find((i) => i.id === specId)
      if (!inst || !inst.installed) {
        return {
          ok: false,
          error: missingBinaryHint(identity)
        }
      }
      // Detection yields to the event loop. A concurrent input may have
      // completed this thread's spawn while we waited, so re-check before the
      // synchronous create/bind sequence to preserve one PTY per thread.
      if (this.hasLiveSession(threadId)) {
        const boundIdentity = this.identityByThread.get(threadId)
        if (boundIdentity !== identity) {
          return {
            ok: false,
            error: `thread ${threadId} already has a live ${boundIdentity ?? 'unknown'} session`
          }
        }
        this.cwdByThread.set(threadId, cwd)
        this.setAttribution(threadId, agentId, attributionSuspect)
        this.setModel(threadId, model)
        this.setInvocationTemplate(threadId, invocationTemplate)
        return { ok: true, sessionId: this.sessionByThread.get(threadId)! }
      }
    }

    const sessionId = this.opts.shellService.create(cwd, undefined, undefined, undefined, identity)
    this.opts.bridge.bind(sessionId, threadId, cwd, adapterForIdentity(identity).id)
    this.sessionByThread.set(threadId, sessionId)
    this.identityByThread.set(threadId, identity)
    this.cwdByThread.set(threadId, cwd)
    this.setAttribution(threadId, agentId, attributionSuspect)
    this.setModel(threadId, model)
    this.setInvocationTemplate(threadId, identity === 'cli-raw' ? invocationTemplate : undefined)
    return { ok: true, sessionId }
  }

  private setModel(threadId: string, model: string | undefined): void {
    if (model !== undefined) this.modelByThread.set(threadId, model)
    else this.modelByThread.delete(threadId)
  }

  private setInvocationTemplate(threadId: string, invocationTemplate: string | undefined): void {
    if (invocationTemplate !== undefined) {
      this.invocationTemplateByThread.set(threadId, invocationTemplate)
    } else {
      this.invocationTemplateByThread.delete(threadId)
    }
  }

  /**
   * Apply the IPC boundary's resolved attribution (contracts §4 v1.2.2).
   * `agentId === undefined` with the suspect tag means validation DEGRADED:
   * the requested slug must not be attributed, so a stale slug stored by a
   * previous validated turn is cleared. Undefined WITHOUT the tag is the
   * ad-hoc absent-field case and never clears a slug bound earlier
   * in-session (bound harness threads re-send their agentId every turn).
   */
  private setAttribution(
    threadId: string,
    agentId: string | undefined,
    attributionSuspect: boolean | undefined
  ): void {
    if (agentId !== undefined) this.agentIdByThread.set(threadId, agentId)
    else if (attributionSuspect === true) this.agentIdByThread.delete(threadId)
    this.attributionSuspectByThread.set(threadId, attributionSuspect === true)
  }

  /**
   * Deliver a user message, respawning the PTY first when no live session is
   * bound. `sessionByThread` is in-memory only, so every persisted CLI thread
   * arrives here dead after an app relaunch.
   */
  async input(
    threadId: string,
    identity: AgentIdentity,
    text: string,
    cwd: string,
    agentId?: string,
    model?: string,
    attributionSuspect?: boolean,
    invocationTemplate?: string
  ): Promise<{ ok: boolean }> {
    if (!isCliAgentIdentity(identity)) return { ok: false }
    if (this.closedThreads.has(threadId)) return { ok: false }
    if (this.hasLiveSession(threadId) && this.identityByThread.get(threadId) !== identity) {
      return { ok: false }
    }
    this.cwdByThread.set(threadId, cwd)
    this.setAttribution(threadId, agentId, attributionSuspect)
    this.setModel(threadId, model)
    this.setInvocationTemplate(threadId, identity === 'cli-raw' ? invocationTemplate : undefined)
    if (!this.hasLiveSession(threadId)) {
      const spawned = await this.spawn(
        threadId,
        identity,
        cwd,
        agentId,
        model,
        attributionSuspect,
        invocationTemplate
      )
      if (!spawned.ok) return { ok: false }
      if (this.closedThreads.has(threadId)) return { ok: false }
      this.opts.onSessionChanged?.(threadId, spawned.sessionId)
    }
    // Phase-1 step-6 lost-reply guard, now main-side (P3 step 4): never type
    // into a fresh shell before its prompt block appears — on EVERY send, not
    // just the spawn-on-demand branch: a `hasLiveSession` short-circuit here
    // would let a concurrent dispatch (or the first input after an explicit
    // spawn) write into a PTY whose prompt has not drawn. Already-seen
    // sessions resolve immediately; a timeout still sends (bounded
    // best-effort, mirroring the renderer poll).
    const sessionId = this.sessionByThread.get(threadId)
    if (sessionId !== undefined && this.opts.waitForSessionReady !== undefined) {
      await this.opts.waitForSessionReady(sessionId)
    }
    if (this.closedThreads.has(threadId)) return { ok: false }
    return { ok: this.sendUserMessage(threadId, identity, text) }
  }

  /**
   * True when a session is bound for `threadId` and its PTY is still alive.
   * Public: the turn registry's degraded-mode window is exactly this probe.
   */
  hasLiveSession(threadId: string): boolean {
    const sid = this.sessionByThread.get(threadId)
    if (!sid) return false
    return this.opts.shellService.getPtyService().getActiveSessions().includes(sid)
  }

  sendUserMessage(threadId: string, identity: AgentIdentity, text: string): boolean {
    if (this.closedThreads.has(threadId)) return false
    const sessionId = this.sessionByThread.get(threadId)
    if (!sessionId) return false
    if (!isCliAgentIdentity(identity)) {
      throw new Error(`sendUserMessage: not a CLI agent identity: ${identity}`)
    }
    if (this.identityByThread.get(threadId) !== identity) return false
    // Per-thread continuity: resume the agent's own session when the bridge
    // captured its id from structured output; fall back to most-recent-in-cwd
    // continuation when a turn was sent but no id is known. The model pick
    // (if any) was validated at the IPC boundary — see `modelByThread`.
    const model = this.modelByThread.get(threadId)
    const adapter = adapterForIdentity(identity)
    let command: string
    let rawExpectationRegistered = false
    if (identity === 'cli-raw') {
      const invocationTemplate = this.invocationTemplateByThread.get(threadId)
      if (invocationTemplate === undefined) return false
      try {
        command = adapter.formatInvocation(text, { invocationTemplate })
      } catch {
        // A missing/corrupt template never opens a turn or writes to the PTY.
        return false
      }
      // Mark the exact next raw block BEFORE the turn window and PTY write.
      // If the adapter-aware bridge binding is absent/stale, fail closed.
      if (!this.opts.bridge.expectRawInvocation(sessionId, command)) return false
      rawExpectationRegistered = true
    } else {
      command = adapter.formatInvocation(text, {
        resumeSessionId: this.opts.bridge.getAgentSessionId(threadId),
        continueConversation: this.turnsSent.has(threadId),
        ...(model !== undefined ? { model } : {})
      })
    }
    // Open the attribution window BEFORE the PTY write: headShaAtStart must
    // be captured before the agent can move HEAD, and the first write must
    // never land ahead of its turn window.
    const cwd = this.cwdByThread.get(threadId)
    try {
      if (this.opts.registry !== undefined && cwd !== undefined) {
        this.opts.registry.turnStarted({
          threadId,
          agentId: this.agentIdByThread.get(threadId) ?? identity,
          cwd,
          attributionSuspect: this.attributionSuspectByThread.get(threadId) === true
        })
      }
      const accepted = this.opts.shellService
        .getPtyService()
        .writeAgentInput(sessionId, `${command}\r`, 'batched')
      if (!accepted) {
        if (rawExpectationRegistered) {
          this.opts.bridge.cancelExpectedRawInvocation(sessionId, command)
        }
        this.opts.registry?.threadClosed(threadId)
        return false
      }
    } catch {
      if (rawExpectationRegistered) {
        this.opts.bridge.cancelExpectedRawInvocation(sessionId, command)
      }
      // If turnStarted succeeded but the write failed, do not leave an open
      // attribution window for unrelated workspace edits.
      this.opts.registry?.threadClosed(threadId)
      return false
    }
    this.turnsSent.add(threadId)
    return true
  }

  close(threadId: string): void {
    this.closedThreads.add(threadId)
    const sid = this.sessionByThread.get(threadId)
    this.sessionByThread.delete(threadId)
    this.identityByThread.delete(threadId)
    this.cwdByThread.delete(threadId)
    this.agentIdByThread.delete(threadId)
    this.modelByThread.delete(threadId)
    this.invocationTemplateByThread.delete(threadId)
    this.attributionSuspectByThread.delete(threadId)
    this.turnsSent.delete(threadId)
    // A killed PTY cannot write: drop the turn window immediately (no
    // linger) so later user edits are never attributed to a dead agent.
    this.opts.registry?.threadClosed(threadId)
    if (sid) this.opts.shellService.kill(brandSessionId(sid))
  }

  /**
   * Send Ctrl+C (`\x03`) into the PTY to interrupt the current `claude --print`
   * (or codex/gemini) invocation. Leaves the PTY open so the next user message
   * can spawn a new invocation in the same shell.
   */
  cancel(threadId: string): boolean {
    const sid = this.sessionByThread.get(threadId)
    if (!sid) return false
    this.opts.shellService.sendRawKeys(brandSessionId(sid), '\x03')
    return true
  }

  /** Look up the bound session id for `threadId`, if any. */
  getSessionId(threadId: string): string | undefined {
    return this.sessionByThread.get(threadId)
  }
}

function missingBinaryHint(identity: CliAgentIdentity): string {
  switch (identity) {
    case 'cli-claude':
      return 'Claude Code is not installed. Run: npm install -g @anthropic-ai/claude-code'
    case 'cli-codex':
      return 'Codex CLI is not installed. See https://github.com/openai/codex'
    case 'cli-gemini':
      return 'Gemini CLI is not installed. See https://github.com/google-gemini/gemini-cli'
    case 'cli-raw':
      // Unreachable: spawn() skips the installed-binary check for raw
      // (nothing to probe). Kept so the switch stays exhaustive.
      return 'Raw CLI sessions have no binary to install.'
  }
}
