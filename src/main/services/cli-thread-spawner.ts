/**
 * CLI thread spawner (Phase 8 Task 8.2).
 *
 * Owns the per-thread shell PTY for `cli-claude` / `cli-codex` / `cli-gemini`
 * threads. Each user message becomes a one-shot non-interactive invocation
 * (`<binary> --print "<prompt>"`-style) written to the PTY, so the existing
 * shell-hook block protocol captures one Block per turn — which the
 * CliAgentThreadBridge converts into one ThreadMessage.
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

const CLI_AGENT_IDENTITIES = ['cli-claude', 'cli-codex', 'cli-gemini'] as const
type CliAgentIdentity = (typeof CLI_AGENT_IDENTITIES)[number]

export function isCliAgentIdentity(value: string): value is CliAgentIdentity {
  return (CLI_AGENT_IDENTITIES as readonly string[]).includes(value)
}

/** Map AgentIdentity (`cli-claude`) to the registry id (`claude`). */
export function specIdForIdentity(identity: AgentIdentity): string {
  return identity.startsWith('cli-') ? identity.slice(4) : identity
}

/**
 * Pure: build the shell command that runs the agent CLI in non-interactive
 * one-shot mode for a given prompt. The result is appended with `\r` by the
 * caller before being enqueued through the PTY write queue.
 */
export function formatCliInvocation(identity: AgentIdentity, prompt: string): string {
  if (!isCliAgentIdentity(identity)) {
    throw new Error(`formatCliInvocation: not a CLI agent identity: ${identity}`)
  }
  const quoted = singleQuote(prompt)
  switch (identity) {
    case 'cli-claude':
      return `claude --print ${quoted}`
    case 'cli-codex':
      return `codex exec ${quoted}`
    case 'cli-gemini':
      return `gemini -p ${quoted}`
  }
}

/** POSIX single-quote escape: wrap in '...' and replace embedded ' with '\''. */
function singleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export type SpawnResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly error: string }

export interface CliThreadSpawnerOptions {
  readonly shellService: ShellService
  readonly bridge: CliAgentThreadBridge
  readonly detect?: () => Promise<readonly CLIAgentInstallation[]>
}

export class CliThreadSpawner {
  /** threadId → sessionId of the bound PTY. */
  private readonly sessionByThread = new Map<string, string>()

  constructor(private readonly opts: CliThreadSpawnerOptions) {}

  async spawn(threadId: string, identity: AgentIdentity, cwd: string): Promise<SpawnResult> {
    if (!isCliAgentIdentity(identity)) {
      return { ok: false, error: `not a CLI agent: ${identity}` }
    }
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

  sendUserMessage(threadId: string, identity: AgentIdentity, text: string): boolean {
    const sessionId = this.sessionByThread.get(threadId)
    if (!sessionId) return false
    const command = formatCliInvocation(identity, text)
    this.opts.shellService.getPtyService().writeAgentInput(sessionId, `${command}\r`, 'batched')
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
