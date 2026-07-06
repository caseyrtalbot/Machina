/**
 * CLI agent → thread bridge (Phase 8 Task 8.1, structured replies in 2.1).
 *
 * Translates terminal Block snapshots emitted by the block protocol into
 * `ThreadMessage` records that the renderer's thread-store mirrors into the
 * active CLI thread.
 *
 * Three surfaces:
 *   - `blockToMessage(block, agent)` — pure mapper. One Block becomes one
 *     assistant message. For agents with structured output (claude
 *     `--output-format stream-json`, codex `exec --json`) the assistant text
 *     is extracted into `message.body` and tool events become inline tool
 *     calls; the raw (terminal-control-stripped) output is kept on the
 *     `cli_command` entry so the renderer can show it as a secondary
 *     expandable card. Plain-text agents fall back to the legacy
 *     `toolCallParser` markers with an empty body.
 *   - `CliAgentThreadBridge` — stateful wrapper with a `sessionId → threadId`
 *     binding map. Observes blocks, streams interim assistant-text deltas
 *     while a block is running, and emits the final message exactly once per
 *     completed block. Sessions started outside of a thread (e.g. user typing
 *     `claude` directly into a terminal) produce no thread events.
 *   - `getAgentSessionId(threadId)` — the agent CLI's own session id
 *     (claude `session_id` / codex `thread_id`) captured from structured
 *     output, used by the spawner to resume the conversation on later turns.
 *
 * Wire contract with the renderer (use-thread-streaming.ts): interim deltas
 * are assistant messages with NO `toolCalls` and no `metadata.endedAt`; the
 * final message ALWAYS carries `toolCalls` (the `cli_command` entry at
 * minimum). The final body always extends the concatenation of the interim
 * deltas, so the renderer can stream-append and finalize without diffing.
 */

import { basename } from 'path'
import {
  getAgentSpec,
  type CLIAgentSpec,
  type ToolCall as ParsedToolCall
} from '@shared/cli-agents'
import { TRUNCATION_MARKER, type Block } from '@shared/engine/block-model'
import type { AssistantMessage, ToolCall, ToolResult } from '@shared/thread-types'
import { stripTerminalControls } from '@shared/engine/terminal-text'

const HINT_MAX = 300
const TOOL_PREVIEW_MAX = 200

export interface CliAgentThreadMessageEvent {
  readonly threadId: string
  readonly message: AssistantMessage
}

interface CliAgentThreadBridgeOptions {
  readonly onMessage: (event: CliAgentThreadMessageEvent) => void
  /**
   * Fired exactly once per completed (or cancelled) block on a bound
   * session — the turn-window close signal for the CliTurnRegistry
   * (workstation step 3). Optional so existing tests stay valid.
   */
  readonly onTurnComplete?: (threadId: string) => void
}

/** Incremental parse state for one block's structured (JSONL) output. */
interface StreamState {
  /** Count of cleaned output lines already consumed. */
  consumedLines: number
  /** Assistant text accumulated so far (segments joined by blank lines). */
  extracted: string
  /** True once any JSON event line parsed — switches off the legacy parser. */
  sawStructured: boolean
  /** True once an assistant text segment was seen (gates the result fallback). */
  sawAssistantText: boolean
  /** Output was truncated or rewritten; stop incremental parsing. */
  degraded: boolean
  /** Tool events parsed out of the structured stream, in order. */
  tools: ParsedToolCall[]
  /** Agent-native session id (claude session_id / codex thread_id). */
  agentSessionId: string | null
}

function newStreamState(): StreamState {
  return {
    consumedLines: 0,
    extracted: '',
    sawStructured: false,
    sawAssistantText: false,
    degraded: false,
    tools: [],
    agentSessionId: null
  }
}

interface BindingState {
  readonly threadId: string
  /** Block ids we have already emitted a final message for (idempotency). */
  readonly emittedBlockIds: Set<string>
  /** Per-block incremental parse state for interim streaming. */
  readonly streamStates: Map<string, StreamState>
}

export class CliAgentThreadBridge {
  private readonly bindings = new Map<string, BindingState>()
  /** threadId → agent-native session id. Outlives PTY sessions on purpose:
   *  the spawner resumes the conversation across respawns within this app run. */
  private readonly agentSessionIdByThread = new Map<string, string>()

  constructor(private readonly opts: CliAgentThreadBridgeOptions) {}

  /** Associate `sessionId` with `threadId`. Subsequent block updates on this
   *  session emit thread messages addressed to `threadId`. */
  bind(sessionId: string, threadId: string): void {
    this.bindings.set(sessionId, {
      threadId,
      emittedBlockIds: new Set(),
      streamStates: new Map()
    })
  }

  /** Agent-native session id captured from structured output, if any. */
  getAgentSessionId(threadId: string): string | undefined {
    return this.agentSessionIdByThread.get(threadId)
  }

  observe(sessionId: string, block: Block): void {
    const binding = this.bindings.get(sessionId)
    if (!binding) return

    const agent = detectAgentFromCommand(block.command)
    if (agent === null) return

    const blockId = block.id as string
    if (binding.emittedBlockIds.has(blockId)) return

    const state = binding.streamStates.get(blockId) ?? newStreamState()
    binding.streamStates.set(blockId, state)

    const finished = block.state.kind === 'completed' || block.state.kind === 'cancelled'
    const delta = supportsStructuredOutput(agent.id)
      ? drainStructuredOutput(state, block, agent, finished)
      : ''
    if (state.agentSessionId !== null) {
      this.agentSessionIdByThread.set(binding.threadId, state.agentSessionId)
    }

    if (!finished) {
      // Interim streaming: emit only the newly extracted text. The final
      // message repeats the full body, so the renderer reconciles by suffix.
      if (delta.length > 0) {
        this.opts.onMessage({
          threadId: binding.threadId,
          message: interimDeltaMessage(block, delta)
        })
      }
      return
    }

    binding.emittedBlockIds.add(blockId)
    binding.streamStates.delete(blockId)
    const message = buildFinalMessage(block, agent, state)
    this.opts.onMessage({ threadId: binding.threadId, message })
    // After the final message: the write-linger window opens from the block's
    // completion, and emittedBlockIds already guarantees once-per-block.
    this.opts.onTurnComplete?.(binding.threadId)
  }

  closeSession(sessionId: string): void {
    // Drop the binding but keep agentSessionIdByThread: continuity must
    // survive PTY death (the spawner respawns and resumes by session id).
    this.bindings.delete(sessionId)
  }
}

/** Agents whose invocations emit machine-readable JSONL (see spawner flags). */
function supportsStructuredOutput(agentId: string): boolean {
  return agentId === 'claude' || agentId === 'codex'
}

/** Pure: translate a terminal `Block` into an assistant `ThreadMessage`. */
export function blockToMessage(block: Block, agent: CLIAgentSpec): AssistantMessage {
  const state = newStreamState()
  if (supportsStructuredOutput(agent.id)) {
    drainStructuredOutput(state, block, agent, true)
  }
  return buildFinalMessage(block, agent, state)
}

/**
 * Consume newly arrived complete lines of the block's output, updating
 * `state` and returning the assistant-text delta extracted this pass.
 * While the block is running the trailing (possibly incomplete) line is left
 * for a later pass; on the final pass every line is consumed.
 */
function drainStructuredOutput(
  state: StreamState,
  block: Block,
  agent: CLIAgentSpec,
  final: boolean
): string {
  if (state.degraded) return ''
  if (block.outputText.includes(TRUNCATION_MARKER)) {
    // The block model capped the output (head + marker + tail): line indices
    // are no longer stable, so stop incremental parsing and keep what we have.
    state.degraded = true
    return ''
  }
  const cleaned = stripTerminalControls(block.outputText)
  const lines = cleaned.split(/\r?\n/)
  const completeCount = final ? lines.length : lines.length - 1
  if (completeCount < state.consumedLines) {
    // Output rewrote itself under us (late-completing escape sequence across
    // a newline). Bail out of incremental mode rather than re-emit text.
    state.degraded = true
    return ''
  }
  const before = state.extracted
  for (const raw of lines.slice(state.consumedLines, completeCount)) {
    const line = raw.trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    state.sawStructured = true
    const event = agent.id === 'claude' ? extractClaudeEvent(parsed) : extractCodexEvent(parsed)
    if (event.agentSessionId !== null) state.agentSessionId = event.agentSessionId
    for (const text of event.texts) appendText(state, text)
    // claude's terminal `result` line repeats the final text — use it only
    // when no assistant event produced text (defensive fallback).
    if (event.resultText !== null && !state.sawAssistantText) {
      appendText(state, event.resultText)
    }
    state.tools.push(...event.tools)
  }
  state.consumedLines = completeCount
  return state.extracted.slice(before.length)
}

function appendText(state: StreamState, text: string): void {
  const segment = text.trim()
  if (segment.length === 0) return
  state.extracted = state.extracted.length > 0 ? `${state.extracted}\n\n${segment}` : segment
  state.sawAssistantText = true
}

interface AgentEvent {
  readonly agentSessionId: string | null
  readonly texts: readonly string[]
  readonly tools: readonly ParsedToolCall[]
  readonly resultText: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function previewOf(value: unknown): string {
  try {
    const json = JSON.stringify(value) ?? ''
    return json.length > TOOL_PREVIEW_MAX ? json.slice(0, TOOL_PREVIEW_MAX) : json
  } catch {
    return ''
  }
}

/** One line of `claude --print --verbose --output-format stream-json`. */
function extractClaudeEvent(obj: Record<string, unknown>): AgentEvent {
  const agentSessionId = typeof obj.session_id === 'string' ? obj.session_id : null
  const texts: string[] = []
  const tools: ParsedToolCall[] = []
  let resultText: string | null = null
  if (obj.type === 'assistant' && isRecord(obj.message) && Array.isArray(obj.message.content)) {
    for (const part of obj.message.content) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text)
      } else if (part.type === 'tool_use' && typeof part.name === 'string') {
        tools.push({ name: part.name, inputPreview: previewOf(part.input) })
      }
    }
  } else if (obj.type === 'result' && typeof obj.result === 'string') {
    resultText = obj.result
  }
  return { agentSessionId, texts, tools, resultText }
}

/** One line of `codex exec --json` (experimental JSONL event stream). */
function extractCodexEvent(obj: Record<string, unknown>): AgentEvent {
  if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
    return { agentSessionId: obj.thread_id, texts: [], tools: [], resultText: null }
  }
  if (obj.type === 'item.completed' && isRecord(obj.item)) {
    const item = obj.item
    const itemType =
      typeof item.type === 'string'
        ? item.type
        : typeof item.item_type === 'string'
          ? item.item_type
          : null
    if (itemType === 'agent_message' && typeof item.text === 'string') {
      return { agentSessionId: null, texts: [item.text], tools: [], resultText: null }
    }
    if (itemType !== null && itemType !== 'agent_message' && itemType !== 'reasoning') {
      return {
        agentSessionId: null,
        texts: [],
        tools: [{ name: itemType, inputPreview: previewOf(item) }],
        resultText: null
      }
    }
  }
  return { agentSessionId: null, texts: [], tools: [], resultText: null }
}

function interimDeltaMessage(block: Block, delta: string): AssistantMessage {
  return {
    role: 'assistant',
    body: delta,
    sentAt: new Date().toISOString(),
    metadata: {
      sessionId: block.metadata.sessionId,
      startedAt: new Date(stateStartedAt(block)).toISOString()
    }
  }
}

function buildFinalMessage(
  block: Block,
  agent: CLIAgentSpec,
  state: StreamState
): AssistantMessage {
  const command = block.command
  const cwd = block.metadata.cwd ?? ''
  const sessionId = block.metadata.sessionId
  const startedAt = stateStartedAt(block)
  const finishedAt = stateFinishedAt(block)
  const callId = `cli_${sessionId}_${block.id}`
  const cleaned = stripTerminalControls(block.outputText)
  const cliCall: ToolCall = { id: callId, kind: 'cli_command', args: { command, cwd } }
  const cliResult = buildCliResult(block, callId, cleaned)

  const inlineCalls = state.sawStructured
    ? state.tools
    : agent.toolCallParser
      ? agent.toolCallParser(cleaned)
      : []
  const inlineEntries = inlineCalls.map((parsed, idx) =>
    inlineToolCallEntry(parsed, agent.id, sessionId, block.id, idx)
  )

  return {
    role: 'assistant',
    body: state.extracted,
    sentAt: new Date(startedAt).toISOString(),
    toolCalls: [{ call: cliCall, result: cliResult }, ...inlineEntries],
    metadata: {
      sessionId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(finishedAt).toISOString()
    }
  }
}

function buildCliResult(block: Block, callId: string, output: string): ToolResult {
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
  if (block.state.kind === 'running') return block.state.startedAt
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
