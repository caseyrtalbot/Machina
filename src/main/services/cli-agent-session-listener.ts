/**
 * CLI agent session listener (Move 8).
 *
 * Subscribes to BlockWatcher updates and, for any block whose command
 * invokes a known CLI agent (Claude Code, Codex, Gemini), classifies the
 * session into `in-progress | success | blocked` and extracts a context
 * snapshot (latest tool call, summary, query, response).
 *
 * Two emit channels:
 *   - onStatus: fires only when the status field changes (e.g. running →
 *     success). Cheap for renderers that only care about transitions.
 *   - onContext: fires when the context payload changes (e.g. a new tool
 *     call appears) without a status change. Renderers can subscribe
 *     selectively.
 *
 * Pure side-effect-free except for the user-supplied emitters; all state
 * lives in this object so it's trivially mockable.
 */

import { basename } from 'path'
import { getAgentSpec, type CLIAgentSpec } from '@shared/cli-agents'
import {
  type CLIAgentSessionContext,
  type CLIAgentSessionState,
  type CLIAgentSessionStatus
} from '@shared/cli-agent-session-types'
import { stripTerminalControls } from '@shared/engine/terminal-text'
import type { Block } from '@shared/engine/block-model'

export type { CLIAgentSessionStatus } from '@shared/cli-agent-session-types'

interface CLIAgentSessionListenerOptions {
  readonly onStatus: (status: CLIAgentSessionStatus) => void
  readonly onContext: (status: CLIAgentSessionStatus) => void
}

interface SessionMemo {
  readonly status: CLIAgentSessionState
  readonly contextKey: string
}

const SUMMARY_MAX = 200
const RESPONSE_MAX = 4000

export class CLIAgentSessionListener {
  private readonly memo = new Map<string, SessionMemo>()

  constructor(private readonly opts: CLIAgentSessionListenerOptions) {}

  observe(sessionId: string, block: Block): void {
    const agent = detectAgentFromCommand(block.command)
    if (agent === null) return
    const status = classifyStatus(block)
    if (status === null) return
    const context = buildContext(sessionId, block, agent)
    const event: CLIAgentSessionStatus = {
      agentId: agent.id,
      sessionId,
      status,
      context
    }
    const contextKey = JSON.stringify(context)
    const prev = this.memo.get(sessionId)
    if (prev && prev.status === status && prev.contextKey === contextKey) return
    this.memo.set(sessionId, { status, contextKey })
    if (!prev || prev.status !== status) {
      this.opts.onStatus(event)
    } else {
      this.opts.onContext(event)
    }
  }

  closeSession(sessionId: string): void {
    this.memo.delete(sessionId)
  }
}

function detectAgentFromCommand(command: string): CLIAgentSpec | null {
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  const firstToken = trimmed.split(/\s+/)[0]
  const binName = basename(firstToken)
  // Iterate via the registry by id so we stay aligned with shared/cli-agents.
  for (const id of ['claude', 'codex', 'gemini']) {
    const spec = getAgentSpec(id)
    if (spec && spec.cliBinary === binName) return spec
  }
  return null
}

function classifyStatus(block: Block): CLIAgentSessionState | null {
  switch (block.state.kind) {
    case 'pending':
      return null
    case 'running':
      return 'in-progress'
    case 'completed':
      return block.state.exitCode === 0 ? 'success' : 'blocked'
    case 'cancelled':
      return 'blocked'
  }
}

function buildContext(
  sessionId: string,
  block: Block,
  agent: CLIAgentSpec
): CLIAgentSessionContext {
  const cleaned = stripTerminalControls(block.outputText)
  const toolCalls = agent.toolCallParser ? agent.toolCallParser(cleaned) : []
  const last = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null
  const cwd = block.metadata.cwd
  return {
    cwd,
    project: cwd ? basename(cwd) : null,
    sessionId,
    toolName: last?.name ?? null,
    toolInputPreview: last?.inputPreview ?? null,
    summary: extractSummary(cleaned),
    query: extractQuery(block.command),
    response: extractResponse(cleaned)
  }
}

function extractSummary(text: string): string | null {
  if (text.length === 0) return null
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null
  const last = lines[lines.length - 1].trim()
  return last.length > SUMMARY_MAX ? `${last.slice(0, SUMMARY_MAX - 1)}…` : last
}

function extractQuery(command: string): string | null {
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  const idx = trimmed.indexOf(' ')
  if (idx === -1) return null
  const args = trimmed.slice(idx + 1).trim()
  return args.length > 0 ? args : null
}

function extractResponse(text: string): string | null {
  if (text.length === 0) return null
  return text.length > RESPONSE_MAX ? `${text.slice(0, RESPONSE_MAX - 1)}…` : text
}
