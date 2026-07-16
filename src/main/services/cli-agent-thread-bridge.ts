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
 *     completed block. Raw-adapter bindings additionally require the spawner
 *     to mark the exact next invocation; arbitrary commands typed by the user
 *     into the same PTY never become agent turns. Sessions started outside of
 *     a thread (e.g. user typing `claude` directly into a terminal) produce no
 *     thread events.
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
import { ADAPTERS, validateRawPtyCommand } from '@shared/agent-adapters'
import type { AdapterId, AgentAdapter, AgentStreamEvent } from '@shared/session-types'
import { TRUNCATION_MARKER, type Block } from '@shared/engine/block-model'
import type { AssistantMessage, ToolCall, ToolResult } from '@shared/thread-types'
import { stripTerminalControls } from '@shared/engine/terminal-text'

const HINT_MAX = 300

export interface CliAgentThreadMessageEvent {
  readonly threadId: string
  readonly message: AssistantMessage
}

interface CliAgentThreadBridgeOptions {
  readonly onMessage: (event: CliAgentThreadMessageEvent) => void
  /**
   * Fired exactly once per completed (or cancelled) block on a bound
   * session — the turn-window close signal for the CliTurnRegistry
   * (workstation step 3). Since P3 step 4 (contracts §4 v1.3.3) it also
   * carries the final assistant message and the binding's bind-time cwd so
   * main can persist the transcript line under the turn's root. Optional so
   * existing tests stay valid; narrower callbacks keep compiling.
   */
  readonly onTurnComplete?: (threadId: string, message: AssistantMessage, cwd: string) => void
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
  /** Root authority for main-side transcript persistence (P3 step 4): the
   *  workspace root captured at bind time. Must outlive spawner.close(),
   *  which wipes cwdByThread and the turn window BEFORE the PTY exit callback
   *  runs settleRunningBlock — this copy is what keeps the mid-turn-kill
   *  synthetic final persistable. */
  readonly cwd: string
  /** Optional adapter declared by the spawner. Only `raw` changes command
   *  recognition; known-agent detection remains command-based. */
  readonly adapterId?: AdapterId
  /** Block ids we have already emitted a final message for (idempotency). */
  readonly emittedBlockIds: Set<string>
  /** Raw blocks admitted by an exact expected-invocation match. Once admitted,
   *  later snapshots of the same block remain recognizable after the one-shot
   *  expectation has been consumed. */
  readonly admittedRawBlockIds: Set<string>
  /** One-shot raw command marker set immediately before the future PTY write. */
  expectedRawInvocation: string | null
  /** Per-block incremental parse state for interim streaming. */
  readonly streamStates: Map<string, StreamState>
  /** Last observed still-running agent block, if any. Used by closeSession to
   *  settle a mid-flight turn when the PTY dies before the block completes. */
  runningBlock: Block | null
}

export class CliAgentThreadBridge {
  private readonly bindings = new Map<string, BindingState>()
  /** threadId → agent-native session id. Outlives PTY sessions on purpose:
   *  the spawner resumes the conversation across respawns within this app run. */
  private readonly agentSessionIdByThread = new Map<string, string>()

  constructor(private readonly opts: CliAgentThreadBridgeOptions) {}

  /** Associate `sessionId` with `threadId`. Subsequent block updates on this
   *  session emit thread messages addressed to `threadId`. `cwd` is the
   *  workspace root the PTY was spawned in (see BindingState.cwd). */
  bind(sessionId: string, threadId: string, cwd: string, adapterId?: AdapterId): void {
    this.bindings.set(sessionId, {
      threadId,
      cwd,
      ...(adapterId !== undefined ? { adapterId } : {}),
      emittedBlockIds: new Set(),
      admittedRawBlockIds: new Set(),
      expectedRawInvocation: null,
      streamStates: new Map(),
      runningBlock: null
    })
  }

  /**
   * Mark the exact command the raw adapter is about to write to this session's
   * PTY. The marker is one-shot and is consumed only by a byte-equal block
   * command; unrelated human commands neither emit nor consume it. Returns
   * false for an unbound/non-raw session or a terminal-control-bearing command
   * so the spawner fails closed before writing.
   */
  expectRawInvocation(sessionId: string, command: string): boolean {
    const binding = this.bindings.get(sessionId)
    if (binding?.adapterId !== 'raw') return false
    // Defense in depth at the final registration boundary: never retain an
    // expectation for bytes the terminal line editor can rewrite before the
    // shell hook reports the executed command.
    if (!validateRawPtyCommand(command).ok) return false
    // One expected command maps to one future block. Refuse overlap instead of
    // replacing the first marker and silently orphaning its turn.
    if (binding.expectedRawInvocation !== null) return false
    binding.expectedRawInvocation = command
    return true
  }

  /** Roll back an expectation when the spawner fails before the PTY write. */
  cancelExpectedRawInvocation(sessionId: string, command: string): void {
    const binding = this.bindings.get(sessionId)
    if (binding?.expectedRawInvocation === command) binding.expectedRawInvocation = null
  }

  /** Agent-native session id captured from structured output, if any. */
  getAgentSessionId(threadId: string): string | undefined {
    return this.agentSessionIdByThread.get(threadId)
  }

  observe(sessionId: string, block: Block): void {
    const binding = this.bindings.get(sessionId)
    if (!binding) return

    const agent = resolveAgentForBlock(binding, block)
    if (agent === null) return

    const blockId = block.id as string
    if (binding.emittedBlockIds.has(blockId)) return

    const state = binding.streamStates.get(blockId) ?? newStreamState()
    binding.streamStates.set(blockId, state)

    const finished = block.state.kind === 'completed' || block.state.kind === 'cancelled'
    const parseEvent = adapterForAgent(agent.id)?.parseEvent
    const delta = parseEvent ? drainStructuredOutput(state, block, parseEvent, finished) : ''
    if (state.agentSessionId !== null) {
      this.agentSessionIdByThread.set(binding.threadId, state.agentSessionId)
    }

    if (!finished) {
      binding.runningBlock = block
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
    if (binding.runningBlock !== null && (binding.runningBlock.id as string) === blockId) {
      binding.runningBlock = null
    }
    const message = buildFinalMessage(block, agent, state)
    this.opts.onMessage({ threadId: binding.threadId, message })
    // After the final message: the write-linger window opens from the block's
    // completion, and emittedBlockIds already guarantees once-per-block.
    this.opts.onTurnComplete?.(binding.threadId, message, binding.cwd)
  }

  closeSession(sessionId: string): void {
    const binding = this.bindings.get(sessionId)
    // A block still mid-flight when the PTY dies would otherwise never get a
    // final message — the renderer's in-flight flag (and the CliTurnRegistry
    // turn window) would stay open forever. Settle it with a synthetic
    // terminated final built from whatever output the block accumulated.
    if (binding) this.settleRunningBlock(binding)
    // Drop the binding but keep agentSessionIdByThread: continuity must
    // survive PTY death (the spawner respawns and resumes by session id).
    this.bindings.delete(sessionId)
  }

  private settleRunningBlock(binding: BindingState): void {
    const block = binding.runningBlock
    if (block === null) return
    const blockId = block.id as string
    if (binding.emittedBlockIds.has(blockId)) return
    const agent = resolveAgentForBlock(binding, block)
    if (agent === null) return
    const state = binding.streamStates.get(blockId) ?? newStreamState()
    const parseEvent = adapterForAgent(agent.id)?.parseEvent
    // Final drain: pick up any trailing complete lines the interim passes
    // left behind (the trailing line is only consumed on a final pass).
    if (parseEvent) drainStructuredOutput(state, block, parseEvent, true)
    binding.emittedBlockIds.add(blockId)
    const message = buildFinalMessage(block, agent, state)
    this.opts.onMessage({ threadId: binding.threadId, message })
    this.opts.onTurnComplete?.(binding.threadId, message, binding.cwd)
  }
}

/**
 * Registry lookup keyed by the CLIAgentSpec id. An adapter carrying a
 * `parseEvent` emits machine-readable JSONL (see spawner flags); an adapter
 * without one — gemini, raw — gets plain PTY passthrough (the legacy
 * `toolCallParser` path), byte-for-byte what gemini got before step 1.
 */
function adapterForAgent(agentId: string): AgentAdapter | undefined {
  return (ADAPTERS as Partial<Record<string, AgentAdapter>>)[agentId as AdapterId]
}

/** Pure: translate a terminal `Block` into an assistant `ThreadMessage`. */
export function blockToMessage(block: Block, agent: CLIAgentSpec): AssistantMessage {
  const state = newStreamState()
  const parseEvent = adapterForAgent(agent.id)?.parseEvent
  if (parseEvent) {
    drainStructuredOutput(state, block, parseEvent, true)
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
  parseEvent: (line: string) => AgentStreamEvent | null,
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
    // The shared parseEvent owns the JSON-line gating (trim, {..} shape,
    // parse, record check). Non-null — including an all-empty event for a
    // parsed-but-unmatched codex record — means "structured output seen".
    const event = parseEvent(raw)
    if (event === null) continue
    state.sawStructured = true
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

  // `degraded` without `sawStructured` means truncation/rewrite hit before a
  // single JSON line parsed — the output is (likely) raw JSONL, and feeding
  // it to the plain-text marker parser would fabricate bogus tool pills.
  const inlineCalls =
    state.sawStructured || state.degraded
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
  if (block.state.kind === 'cancelled') {
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
  // Still running/pending: only reachable via closeSession's synthetic final
  // when the PTY died mid-turn.
  return {
    id: callId,
    ok: false,
    error: {
      code: 'IO_FATAL',
      message: 'session terminated',
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
): { call: ToolCall; result: ToolResult } {
  const toolKey = normalizeToolName(parsed.name)
  const id = `cli_${sessionId}_${blockId}_${idx}_${toolKey}`
  const kind = `cli_${agentId}_${toolKey}` as `cli_${string}_${string}`
  const call: ToolCall = { id, kind, args: { preview: parsed.inputPreview } }
  if (toolKey === 'error') {
    return {
      call,
      result: {
        id,
        ok: false,
        error: {
          code: 'IO_FATAL',
          message: `${agentDisplayName(agentId)} reported error`,
          hint: parsed.inputPreview
        }
      }
    }
  }
  return { call, result: { id, ok: true, output: { preview: parsed.inputPreview } } }
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

function agentDisplayName(agentId: string): string {
  const spec = getAgentSpec(agentId)
  return spec?.displayName.replace(/\s+CLI$/, '') ?? agentId
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

/**
 * Resolve the agent responsible for one block without broadening the existing
 * known-CLI heuristic. A raw-bound PTY is special: its executable is arbitrary,
 * so only an exact command explicitly marked before the PTY write is admitted.
 * The admitted block id then carries that identity through later running/final
 * snapshots and closeSession's synthetic finalization.
 */
function resolveAgentForBlock(binding: BindingState, block: Block): CLIAgentSpec | null {
  if (binding.adapterId !== 'raw') return detectAgentFromCommand(block.command)

  const blockId = block.id as string
  if (binding.admittedRawBlockIds.has(blockId)) return getAgentSpec('raw')
  if (binding.expectedRawInvocation === null || block.command !== binding.expectedRawInvocation) {
    return null
  }

  const raw = getAgentSpec('raw')
  if (raw === null) return null
  binding.expectedRawInvocation = null
  binding.admittedRawBlockIds.add(blockId)
  return raw
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
