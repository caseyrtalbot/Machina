/**
 * CLI thread spawner (Phase 8 Task 8.2).
 *
 * Owns the per-thread shell PTY for `cli-claude` / `cli-codex` / `cli-gemini`
 * threads. Each user message becomes a one-shot non-interactive invocation
 * (`claude --print …` / `codex exec …`) written to the PTY, so the existing
 * shell-hook block protocol captures one Block per turn — which the
 * CliAgentThreadBridge converts into one ThreadMessage. Subsequent turns
 * resume the agent's own session (see `CliInvocationOptions`).
 *
 * The detector is injected so the spawner stays trivially testable without
 * shelling out. Pure helpers (`formatCliInvocation`, `isCliAgentIdentity`)
 * sit alongside the stateful service for direct unit testing.
 */

import type { AgentIdentity } from '@shared/agent-identity'
import type { CLIAgentInstallation } from '@shared/cli-agents'
import { sessionId as brandSessionId } from '@shared/types'
import type { ShellService } from './shell-service'
import type { CliAgentThreadBridge } from './cli-agent-thread-bridge'
import { detectInstalledAgents } from './cli-agent-detector'
import { commitPreAgentSnapshot } from './vault-git'

const CLI_AGENT_IDENTITIES = ['cli-claude', 'cli-codex', 'cli-gemini'] as const
type CliAgentIdentity = (typeof CLI_AGENT_IDENTITIES)[number]

export function isCliAgentIdentity(value: string): value is CliAgentIdentity {
  return (CLI_AGENT_IDENTITIES as readonly string[]).includes(value)
}

/** Map AgentIdentity (`cli-claude`) to the registry id (`claude`). */
export function specIdForIdentity(identity: AgentIdentity): string {
  return identity.startsWith('cli-') ? identity.slice(4) : identity
}

export interface CliInvocationOptions {
  /**
   * Agent-native session id captured from a previous turn's structured
   * output (claude `session_id` / codex `thread_id`). When set, the
   * invocation resumes that exact conversation — immune to other CLI runs
   * in the same cwd (ghost emerge, parallel threads).
   */
  readonly resumeSessionId?: string
  /**
   * True when a prior turn was already sent for this thread. Degraded
   * fallback when no session id was captured: claude `--continue` / codex
   * `resume --last` pick the most recent conversation in the cwd.
   */
  readonly continueConversation?: boolean
}

/** Conservative shape for an id that is safe to interpolate into a shell line. */
const SAFE_AGENT_SESSION_ID_RE = /^[0-9a-zA-Z-]{8,64}$/

/**
 * Pure: build the shell command that runs the agent CLI in non-interactive
 * one-shot mode for a given prompt. The result is appended with `\r` by the
 * caller before being enqueued through the PTY write queue.
 *
 * claude and codex run with machine-readable output (`stream-json` / `--json`)
 * so the thread bridge can extract assistant text and stream interim deltas;
 * gemini has no structured mode and stays a plain one-shot.
 */
export function formatCliInvocation(
  identity: AgentIdentity,
  prompt: string,
  opts: CliInvocationOptions = {}
): string {
  if (!isCliAgentIdentity(identity)) {
    throw new Error(`formatCliInvocation: not a CLI agent identity: ${identity}`)
  }
  const quoted = singleQuote(prompt)
  const resumeId =
    opts.resumeSessionId !== undefined && SAFE_AGENT_SESSION_ID_RE.test(opts.resumeSessionId)
      ? opts.resumeSessionId
      : null
  switch (identity) {
    case 'cli-claude': {
      // --verbose is mandatory: `claude --print --output-format stream-json`
      // exits with an error without it.
      const base = 'claude --print --verbose --output-format stream-json'
      if (resumeId !== null) return `${base} --resume ${resumeId} ${quoted}`
      if (opts.continueConversation === true) return `${base} --continue ${quoted}`
      return `${base} ${quoted}`
    }
    case 'cli-codex': {
      // --skip-git-repo-check: vaults are not guaranteed to be git repos and
      // codex exec refuses to run outside one otherwise.
      const flags = '--json --skip-git-repo-check'
      if (resumeId !== null) return `codex exec resume ${flags} ${resumeId} ${quoted}`
      if (opts.continueConversation === true) return `codex exec resume ${flags} --last ${quoted}`
      return `codex exec ${flags} ${quoted}`
    }
    case 'cli-gemini':
      return `gemini -p ${quoted}`
  }
}

/** POSIX single-quote escape: wrap in '...' and replace embedded ' with '\''. */
function singleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

type SpawnResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly error: string }

interface CliThreadSpawnerOptions {
  readonly shellService: ShellService
  readonly bridge: CliAgentThreadBridge
  readonly detect?: () => Promise<readonly CLIAgentInstallation[]>
}

export class CliThreadSpawner {
  /** threadId → sessionId of the bound PTY. */
  private readonly sessionByThread = new Map<string, string>()
  /**
   * Threads that already received at least one turn in this app run.
   * Deliberately not cleared on close(): conversation continuity outlives
   * the PTY (the next turn resumes the agent session in a fresh shell).
   * In-memory only — after an app relaunch the first turn starts a fresh
   * agent conversation even though the thread UI shows history.
   */
  private readonly turnsSent = new Set<string>()

  constructor(private readonly opts: CliThreadSpawnerOptions) {}

  async spawn(threadId: string, identity: AgentIdentity, cwd: string): Promise<SpawnResult> {
    if (!isCliAgentIdentity(identity)) {
      return { ok: false, error: `not a CLI agent: ${identity}` }
    }
    // Rollback safety: snapshot the vault before the agent can touch it.
    // Never blocks the spawn — returns a structured no-op on non-repo,
    // opt-out, nothing-to-commit, or git failure.
    commitPreAgentSnapshot(cwd, threadId)
    const detect = this.opts.detect ?? detectInstalledAgents
    const installations = await detect()
    const specId = specIdForIdentity(identity)
    const inst = installations.find((i) => i.id === specId)
    if (!inst || !inst.installed) {
      return {
        ok: false,
        error: missingBinaryHint(identity)
      }
    }

    const sessionId = this.opts.shellService.create(cwd, undefined, undefined, undefined, identity)
    this.opts.bridge.bind(sessionId, threadId)
    this.sessionByThread.set(threadId, sessionId)
    return { ok: true, sessionId }
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
    cwd: string
  ): Promise<{ ok: boolean }> {
    if (!this.hasLiveSession(threadId)) {
      const spawned = await this.spawn(threadId, identity, cwd)
      if (!spawned.ok) return { ok: false }
    }
    return { ok: this.sendUserMessage(threadId, identity, text) }
  }

  /** True when a session is bound for `threadId` and its PTY is still alive. */
  private hasLiveSession(threadId: string): boolean {
    const sid = this.sessionByThread.get(threadId)
    if (!sid) return false
    return this.opts.shellService.getPtyService().getActiveSessions().includes(sid)
  }

  sendUserMessage(threadId: string, identity: AgentIdentity, text: string): boolean {
    const sessionId = this.sessionByThread.get(threadId)
    if (!sessionId) return false
    // Per-thread continuity: resume the agent's own session when the bridge
    // captured its id from structured output; fall back to most-recent-in-cwd
    // continuation when a turn was sent but no id is known.
    const command = formatCliInvocation(identity, text, {
      resumeSessionId: this.opts.bridge.getAgentSessionId(threadId),
      continueConversation: this.turnsSent.has(threadId)
    })
    this.opts.shellService.getPtyService().writeAgentInput(sessionId, `${command}\r`, 'batched')
    this.turnsSent.add(threadId)
    return true
  }

  close(threadId: string): void {
    const sid = this.sessionByThread.get(threadId)
    if (!sid) return
    this.opts.shellService.kill(brandSessionId(sid))
    this.sessionByThread.delete(threadId)
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
  }
}
