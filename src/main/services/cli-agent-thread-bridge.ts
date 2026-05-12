/**
 * CLI agent → thread bridge (Phase 8 Task 8.1).
 *
 * Translates terminal Block snapshots emitted by the block protocol into
 * `ThreadMessage` records that the renderer's thread-store mirrors into the
 * active CLI thread.
 *
 * Two surfaces:
 *   - `blockToMessage(block, agent)` — pure mapper. One Block becomes one
 *     assistant message whose `toolCalls[0]` is the `cli_command` invocation
 *     and whose remaining entries are the inline tool calls parsed out of the
 *     CLI's own output (e.g. Claude's `⏺ Read(...)` markers).
 *   - `CliAgentThreadBridge` — stateful wrapper with a `sessionId → threadId`
 *     binding map. Observes blocks and emits `onMessage` exactly once per
 *     completed block, and only when the session has been bound. Sessions
 *     started outside of a thread (e.g. user typing `claude` directly into a
 *     terminal) produce no thread events.
 *
 * Pure side-effect-free except for the user-supplied emitter; all state lives
 * on this object so it's trivially mockable.
 */

import { basename } from 'path'
import {
  getAgentSpec,
  type CLIAgentSpec,
  type ToolCall as ParsedToolCall
} from '@shared/cli-agents'
import type { Block } from '@shared/engine/block-model'
import type { AssistantMessage, ToolCall, ToolResult } from '@shared/thread-types'
import { stripTerminalControls } from '@shared/engine/terminal-text'

const HINT_MAX = 300

export interface CliAgentThreadMessageEvent {
  readonly threadId: string
  readonly message: AssistantMessage
}

interface CliAgentThreadBridgeOptions {
  readonly onMessage: (event: CliAgentThreadMessageEvent) => void
}

interface BindingState {
  readonly threadId: string
  /** Block ids we have already emitted for, so observe() is idempotent. */
  readonly emittedBlockIds: Set<string>
}

export class CliAgentThreadBridge {
  private readonly bindings = new Map<string, BindingState>()

  constructor(private readonly opts: CliAgentThreadBridgeOptions) {}

  /** Associate `sessionId` with `threadId`. Subsequent block completions on
   *  this session emit thread messages addressed to `threadId`. */
  bind(sessionId: string, threadId: string): void {
    this.bindings.set(sessionId, { threadId, emittedBlockIds: new Set() })
  }

  observe(sessionId: string, block: Block): void {
    const binding = this.bindings.get(sessionId)
    if (!binding) return
    if (block.state.kind !== 'completed' && block.state.kind !== 'cancelled') return

    const agent = detectAgentFromCommand(block.command)
    if (agent === null) return

    const blockId = block.id as string
    if (binding.emittedBlockIds.has(blockId)) return
    binding.emittedBlockIds.add(blockId)

    const message = blockToMessage(block, agent)
    this.opts.onMessage({ threadId: binding.threadId, message })
  }

  closeSession(sessionId: string): void {
    this.bindings.delete(sessionId)
  }
}

/** Pure: translate a terminal `Block` into an assistant `ThreadMessage`. */
export function blockToMessage(block: Block, agent: CLIAgentSpec): AssistantMessage {
  const command = block.command
  const cwd = block.metadata.cwd ?? ''
  const sessionId = block.metadata.sessionId
  const startedAt = stateStartedAt(block)
  const finishedAt = stateFinishedAt(block)
  const callId = `cli_${sessionId}_${block.id}`
  const cliCall: ToolCall = { id: callId, kind: 'cli_command', args: { command, cwd } }
  const cliResult = buildCliResult(block, callId)

  const cleaned = stripTerminalControls(block.outputText)
  const inlineCalls = agent.toolCallParser ? agent.toolCallParser(cleaned) : []
  const inlineEntries = inlineCalls.map((parsed, idx) =>
    inlineToolCallEntry(parsed, agent.id, sessionId, block.id, idx)
  )

  return {
    role: 'assistant',
    body: '',
    sentAt: new Date(startedAt).toISOString(),
    toolCalls: [{ call: cliCall, result: cliResult }, ...inlineEntries],
    metadata: {
      sessionId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(finishedAt).toISOString()
    }
  }
}

function buildCliResult(block: Block, callId: string): ToolResult {
  const output = block.outputText ?? ''
  if (block.state.kind === 'completed' && block.state.exitCode === 0) {
    return { id: callId, ok: true, output: { output, exitCode: 0 } }
  }
  if (block.state.kind === 'completed') {
    return {
      id: callId,
      ok: false,
      error: {
        code: 'IO_FATAL',
        message: `exit ${block.state.exitCode}`,
        hint: tail(output, HINT_MAX)
      }
    }
  }
  // cancelled
  return {
    id: callId,
    ok: false,
    error: {
      code: 'IO_FATAL',
      message: 'cancelled (exit -1)',
      hint: tail(output, HINT_MAX)
    }
  }
}

function inlineToolCallEntry(
  parsed: ParsedToolCall,
  agentId: string,
  sessionId: string,
  blockId: string,
  idx: number
): { call: ToolCall; result?: ToolResult } {
  const toolKey = normalizeToolName(parsed.name)
  const id = `cli_${sessionId}_${blockId}_${idx}_${toolKey}`
  const kind = `cli_${agentId}_${toolKey}` as `cli_${string}_${string}`
  const call: ToolCall = { id, kind, args: { preview: parsed.inputPreview } }
  return { call }
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

function tail(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(s.length - n)
}

function stateStartedAt(block: Block): number {
  if (block.state.kind === 'completed' || block.state.kind === 'cancelled') {
    return block.state.startedAt
  }
  return Date.now()
}

function stateFinishedAt(block: Block): number {
  if (block.state.kind === 'completed' || block.state.kind === 'cancelled') {
    return block.state.finishedAt
  }
  return Date.now()
}

function detectAgentFromCommand(command: string): CLIAgentSpec | null {
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  const firstToken = trimmed.split(/\s+/)[0]
  const binName = basename(firstToken)
  for (const id of ['claude', 'codex', 'gemini']) {
    const spec = getAgentSpec(id)
    if (spec && spec.cliBinary === binName) return spec
  }
  return null
}
