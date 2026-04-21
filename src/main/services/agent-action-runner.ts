import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CanvasNodeType, CanvasSide } from '@shared/canvas-types'
import type { CanvasMutationOp, CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type {
  AgentActionName,
  AgentActionRequest,
  AgentActionResponse,
  AgentContext,
  AgentErrorTag,
  AgentStreamEvent
} from '@shared/agent-action-types'
import type { Result } from '@shared/engine/types'
import {
  isClusterProducingAction,
  newClusterId,
  stampRootCardWithCluster
} from './agent-action-runner-helpers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_NODE_TYPES = new Set<CanvasNodeType>([
  'text',
  'note',
  'terminal',
  'code',
  'markdown',
  'image',
  'pdf',
  'project-file',
  'system-artifact',
  'file-view',
  'agent-session',
  'project-folder'
])

const VALID_SIDES = new Set<CanvasSide>(['top', 'right', 'bottom', 'left'])

const DEFAULT_SIZE = { width: 200, height: 100 }

const SILENCE_WATCHDOG_MS = 30_000
const TOTAL_CAP_MS = 180_000

/** Resolve the claude CLI binary, checking common install locations if not on PATH. */
function resolveClaudeBin(): string {
  const home = process.env.HOME ?? ''
  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    join(home, '.nvm', 'current', 'bin', 'claude')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'claude'
}

const CLAUDE_BIN = resolveClaudeBin()

// ---------------------------------------------------------------------------
// JSON Extraction
// ---------------------------------------------------------------------------

export function extractJsonFromResponse(text: string): unknown {
  // Try code fence first (```json or bare ```)
  const fenceMatch = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text)
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim())
  }

  // Try raw JSON object
  const objectMatch = /(\{[\s\S]*\})/.exec(text)
  if (objectMatch) {
    return JSON.parse(objectMatch[1].trim())
  }

  throw new Error('No JSON found in response')
}

// ---------------------------------------------------------------------------
// Op Validation
// ---------------------------------------------------------------------------

function uid(): string {
  return `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasXY(v: unknown): v is { x: number; y: number } {
  return isObj(v) && typeof v.x === 'number' && typeof v.y === 'number'
}

function hasWH(v: unknown): v is { width: number; height: number } {
  return isObj(v) && typeof v.width === 'number' && typeof v.height === 'number'
}

function validateSingleOp(raw: unknown): Result<CanvasMutationOp> {
  if (!isObj(raw) || typeof raw.type !== 'string') {
    return { ok: false, error: 'Op must be an object with a string "type"' }
  }

  switch (raw.type) {
    case 'add-node': {
      const node = raw.node
      if (!isObj(node)) return { ok: false, error: 'add-node requires a "node" object' }
      if (typeof node.type !== 'string' || !VALID_NODE_TYPES.has(node.type as CanvasNodeType)) {
        return { ok: false, error: `Invalid node type: ${String(node.type)}` }
      }
      if (!hasXY(node.position)) {
        return { ok: false, error: 'add-node node requires position {x, y}' }
      }
      const nodeType = node.type as CanvasNodeType
      const size = hasWH(node.size) ? node.size : DEFAULT_SIZE
      const id = typeof node.id === 'string' && node.id ? node.id : uid()
      const content = typeof node.content === 'string' ? node.content : ''
      const metadata = isObj(node.metadata) ? node.metadata : {}

      return {
        ok: true,
        value: {
          type: 'add-node',
          node: {
            id,
            type: nodeType,
            position: { x: node.position.x, y: node.position.y },
            size: { width: size.width, height: size.height },
            content,
            metadata: { ...metadata }
          }
        }
      }
    }

    case 'add-edge': {
      const edge = raw.edge
      if (!isObj(edge)) return { ok: false, error: 'add-edge requires an "edge" object' }
      if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string') {
        return { ok: false, error: 'add-edge requires fromNode and toNode strings' }
      }
      const id = typeof edge.id === 'string' && edge.id ? edge.id : uid()
      const fromSide =
        typeof edge.fromSide === 'string' && VALID_SIDES.has(edge.fromSide as CanvasSide)
          ? (edge.fromSide as CanvasSide)
          : 'bottom'
      const toSide =
        typeof edge.toSide === 'string' && VALID_SIDES.has(edge.toSide as CanvasSide)
          ? (edge.toSide as CanvasSide)
          : 'top'
      const kind = typeof edge.kind === 'string' ? edge.kind : undefined
      const label = typeof edge.label === 'string' ? edge.label : undefined

      return {
        ok: true,
        value: {
          type: 'add-edge',
          edge: { id, fromNode: edge.fromNode, toNode: edge.toNode, fromSide, toSide, kind, label }
        }
      }
    }

    case 'move-node': {
      if (typeof raw.nodeId !== 'string') {
        return { ok: false, error: 'move-node requires a "nodeId" string' }
      }
      if (!hasXY(raw.position)) {
        return { ok: false, error: 'move-node requires position {x, y}' }
      }
      return {
        ok: true,
        value: {
          type: 'move-node',
          nodeId: raw.nodeId,
          position: { x: raw.position.x, y: raw.position.y }
        }
      }
    }

    case 'resize-node': {
      if (typeof raw.nodeId !== 'string') {
        return { ok: false, error: 'resize-node requires a "nodeId" string' }
      }
      if (!hasWH(raw.size)) {
        return { ok: false, error: 'resize-node requires size {width, height}' }
      }
      return {
        ok: true,
        value: {
          type: 'resize-node',
          nodeId: raw.nodeId,
          size: { width: raw.size.width, height: raw.size.height }
        }
      }
    }

    case 'remove-node': {
      if (typeof raw.nodeId !== 'string') {
        return { ok: false, error: 'remove-node requires a "nodeId" string' }
      }
      return { ok: true, value: { type: 'remove-node', nodeId: raw.nodeId } }
    }

    case 'remove-edge': {
      if (typeof raw.edgeId !== 'string') {
        return { ok: false, error: 'remove-edge requires an "edgeId" string' }
      }
      return { ok: true, value: { type: 'remove-edge', edgeId: raw.edgeId } }
    }

    default:
      return { ok: false, error: `Unknown op type: ${raw.type}` }
  }
}

export function validateAgentOps(raw: unknown): Result<CanvasMutationOp[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Ops must be an array' }
  }

  const validated: CanvasMutationOp[] = []
  for (const item of raw) {
    const result = validateSingleOp(item)
    if (!result.ok) return result
    validated.push(result.value)
  }

  return { ok: true, value: validated }
}

// ---------------------------------------------------------------------------
// Plan Builder
// ---------------------------------------------------------------------------

export function buildPlanFromOps(ops: readonly CanvasMutationOp[]): CanvasMutationPlan {
  let addedNodes = 0
  let addedEdges = 0
  let movedNodes = 0

  for (const op of ops) {
    switch (op.type) {
      case 'add-node':
        addedNodes++
        break
      case 'add-edge':
        addedEdges++
        break
      case 'move-node':
        movedNodes++
        break
    }
  }

  return {
    id: `plan_${Date.now().toString(36)}`,
    operationId: `agentop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'agent',
    ops,
    summary: {
      addedNodes,
      addedEdges,
      movedNodes,
      skippedFiles: 0,
      unresolvedRefs: 0
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

const ACTION_INSTRUCTIONS: Record<AgentActionName, string> = {
  challenge:
    'You are a critical thinking partner. Examine the selected cards and surface contradictions, ' +
    'weak assumptions, and missing perspectives. Create new cards that challenge the ideas presented. ' +
    'Place challenge cards near the cards they question and connect them with edges.',

  emerge:
    'You are a pattern synthesizer. Look across the selected cards and their neighbors to find ' +
    'hidden connections, emergent themes, and synthesis opportunities. Create new cards that capture ' +
    'these insights and connect them to the source cards with edges.',

  organize:
    'You are a spatial organizer. Analyze the selected cards by theme, topic, or relationship. ' +
    'Move cards into coherent groups with clear spatial separation between groups. ' +
    'Add edges between related cards if connections are missing.',

  tidy:
    'You are a layout optimizer. Clean up the canvas layout by resolving overlaps, aligning cards ' +
    'to a grid, and improving spacing. Move and resize cards as needed. Do not change content or ' +
    'add new cards unless absolutely necessary.',

  compile:
    'You are a knowledge compiler. Read the selected source cards and compile them into structured ' +
    'knowledge articles. For each key concept, claim, or theme in the sources, emit a ' +
    '`materialize-artifact` operation (NOT `add-node`). Each operation must include:\n' +
    '- `type`: "materialize-artifact"\n' +
    '- `draft.kind`: "compiled-article"\n' +
    '- `draft.title`: a descriptive article title\n' +
    '- `draft.body`: the full article content in markdown\n' +
    '- `draft.origin`: "agent"\n' +
    '- `draft.sources`: array of source card titles (e.g. ["Paper A", "Paper B"])\n' +
    '- `draft.tags`: array of tags consistent with the vault\n' +
    '- `placement`: {x, y, width, height} positioning new cards near their sources in a visible cluster\n' +
    '- `tempNodeId`: a unique string ID (e.g. "compiled_1") so subsequent add-edge ops can reference it\n\n' +
    'After materialize-artifact ops, emit add-edge ops connecting compiled articles to their source ' +
    'cards and to each other where concepts relate. Use the tempNodeId values as edge endpoints.',

  ask:
    'You are a thinking partner working on a spatial canvas. The user has a question ' +
    'or instruction about the cards in view. Respond by creating new cards, adding edges, ' +
    'or reorganizing existing cards as appropriate. Your response should materialize on ' +
    'the canvas as spatial objects the user can grab and build on, not as a text reply ' +
    'in a chat window. Set metadata.origin to "agent" on new cards.'
}

function formatCards(context: AgentContext): string {
  return context.selectedCards
    .map(
      (c) =>
        `- Card "${c.title}" (id: ${c.id}, type: ${c.type})\n` +
        `  Position: (${c.position.x}, ${c.position.y}), Size: ${c.size.width}x${c.size.height}\n` +
        `  Tags: ${c.tags.length > 0 ? c.tags.join(', ') : 'none'}\n` +
        `  Content: ${c.body}`
    )
    .join('\n')
}

function formatNeighbors(context: AgentContext): string {
  if (context.neighbors.length === 0) return 'None'
  return context.neighbors
    .map((n) => `- "${n.title}" (id: ${n.id}, edge: ${n.edgeKind}, tags: ${n.tags.join(', ')})`)
    .join('\n')
}

function formatEdges(context: AgentContext): string {
  if (context.edges.length === 0) return 'None'
  return context.edges
    .map(
      (e) =>
        `- ${e.fromNode} -> ${e.toNode}` +
        (e.kind ? ` (${e.kind})` : '') +
        (e.label ? ` "${e.label}"` : '')
    )
    .join('\n')
}

const VAULT_SCOPE_PREAMBLE =
  'You are operating at VAULT SCOPE. Instead of selected cards, you have been given a structural ' +
  'overview of the entire vault: artifact summaries (title, type, signal, tags), the tag tree, and ' +
  'unresolved references (ghosts). Identify the most important areas to address and produce your ' +
  'output as new cards positioned in open canvas space.\n\n'

export function buildPrompt(
  action: AgentActionName,
  context: AgentContext,
  userPrompt?: string
): string {
  const instructions = context.vaultScope
    ? VAULT_SCOPE_PREAMBLE + ACTION_INSTRUCTIONS[action]
    : ACTION_INSTRUCTIONS[action]
  const cards = formatCards(context)
  const neighbors = formatNeighbors(context)
  const edges = formatEdges(context)
  const { viewportBounds, totalCardCount } = context.canvasMeta

  return `# Canvas Agent: ${action}

${instructions}
${userPrompt ? `\n## User Prompt\n\n${userPrompt}\n` : ''}
## Selected Cards

${cards}

## Neighboring Cards

${neighbors}

## Existing Edges

${edges}

## Canvas Info

Viewport: (${viewportBounds.x}, ${viewportBounds.y}) ${viewportBounds.width}x${viewportBounds.height}
Total cards on canvas: ${totalCardCount}

## Response Format

Respond with a JSON object containing an "ops" array. Each op must be one of:

- {"type": "add-node", "node": {"id": "unique_id", "type": "markdown", "position": {"x": 0, "y": 0}, "size": {"width": 200, "height": 100}, "content": "...", "metadata": {}}}
- {"type": "add-edge", "edge": {"fromNode": "id", "toNode": "id", "fromSide": "bottom", "toSide": "top"}}
- {"type": "move-node", "nodeId": "id", "position": {"x": 0, "y": 0}}
- {"type": "resize-node", "nodeId": "id", "size": {"width": 200, "height": 100}}
- {"type": "remove-node", "nodeId": "id"}
- {"type": "remove-edge", "edgeId": "id"}

Valid node types: text, note, code, markdown, image, terminal, pdf, project-file, system-artifact, file-view, agent-session, project-folder.
Valid sides: top, right, bottom, left.

Before the JSON fence, briefly state your plan in 1-2 sentences so the user sees what you're about to do. Then wrap your JSON in a \`\`\`json code fence.`
}

// ---------------------------------------------------------------------------
// Claude CLI Caller (injectable for testing)
// ---------------------------------------------------------------------------

export type OnStreamEvent = (ev: AgentStreamEvent) => void
export type CallClaudeFn = (prompt: string, onEvent?: OnStreamEvent) => Promise<string>

type SpawnFn = typeof spawn

/** The currently running Claude subprocess, if any. Allows cancellation. */
let _activeProc: ChildProcess | null = null

/** Kill the active Claude subprocess, if one is running. */
export function cancelAgentAction(): void {
  if (_activeProc) {
    _activeProc.kill('SIGTERM')
    _activeProc = null
  }
}

/** Error with a tag for the renderer to map to copy. */
class TaggedError extends Error {
  readonly tag: AgentErrorTag
  constructor(message: string, tag: AgentErrorTag) {
    super(message)
    this.tag = tag
  }
}

/**
 * Split a growing buffer into complete JSONL lines and a trailing partial.
 * Returns the parsed objects and the new buffer state.
 */
function takeCompleteLines(buf: string): { lines: unknown[]; rest: string } {
  const parts = buf.split('\n')
  const rest = parts.pop() ?? ''
  const lines: unknown[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed))
    } catch {
      // Skip non-JSON lines (e.g. blank, partial)
    }
  }
  return { lines, rest }
}

/**
 * Internal streaming caller — spawn is injected for testing.
 * Resolves with the full text buffer (joined text_deltas + any result.result fallback).
 */
export function callClaudeWith(
  spawnFn: SpawnFn,
  prompt: string,
  onEvent: OnStreamEvent = () => {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(
      CLAUDE_BIN,
      ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    _activeProc = proc

    let stderr = ''
    let textBuf = ''
    let resultFallback: string | null = null
    let sawFirstTextDelta = false
    let sawThinking = false
    let stdoutBuf = ''
    let settled = false

    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    let totalTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
      if (totalTimer) {
        clearTimeout(totalTimer)
        totalTimer = null
      }
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimers()
      if (_activeProc === proc) _activeProc = null
      fn()
    }

    const resetSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        settle(() => {
          reject(new TaggedError('Agent stalled: no activity for 30s', 'stalled'))
          proc.kill('SIGTERM')
        })
      }, SILENCE_WATCHDOG_MS)
    }

    totalTimer = setTimeout(() => {
      settle(() => {
        reject(new TaggedError('Agent exceeded 3-minute total cap', 'cap'))
        proc.kill('SIGTERM')
      })
    }, TOTAL_CAP_MS)

    resetSilence()

    const handleJsonEvent = (obj: unknown) => {
      if (typeof obj !== 'object' || obj === null) return
      const o = obj as Record<string, unknown>

      if (o.type === 'result' && typeof o.result === 'string') {
        resultFallback = o.result
        return
      }
      if (o.type !== 'stream_event') return

      const event = o.event as Record<string, unknown> | undefined
      if (!event || typeof event.type !== 'string') return

      if (event.type === 'message_start') {
        if (!sawThinking) {
          sawThinking = true
          onEvent({ kind: 'phase', phase: 'thinking' })
        }
        return
      }

      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (!delta || typeof delta.type !== 'string') return

        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          if (!sawThinking) {
            sawThinking = true
            onEvent({ kind: 'phase', phase: 'thinking' })
          }
          onEvent({ kind: 'thinking-delta', text: delta.thinking })
          return
        }

        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (!sawFirstTextDelta) {
            sawFirstTextDelta = true
            onEvent({ kind: 'phase', phase: 'drafting' })
          }
          textBuf += delta.text
          onEvent({ kind: 'text-delta', text: delta.text })
          return
        }
        // Ignore signature_delta and other delta types
      }
    }

    const onStdoutChunk = (text: string) => {
      if (!text) return
      resetSilence()
      stdoutBuf += text
      const { lines, rest } = takeCompleteLines(stdoutBuf)
      stdoutBuf = rest
      for (const line of lines) handleJsonEvent(line)
    }

    const onStderrChunk = (text: string) => {
      if (!text) return
      resetSilence()
      stderr += text
    }

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      onStdoutChunk(Buffer.isBuffer(chunk) ? chunk.toString() : chunk)
    })
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      onStderrChunk(Buffer.isBuffer(chunk) ? chunk.toString() : chunk)
    })

    proc.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === 'ENOENT') {
          reject(new TaggedError(`Claude CLI not found: ${err.message}`, 'not-found'))
        } else {
          reject(new TaggedError(`Failed to spawn claude: ${err.message}`, 'cli-error'))
        }
      })
    })

    proc.on('close', (code) => {
      // Defer to nextTick so any stdout/stderr data events queued by the stream
      // have a chance to fire before we finalize the result. Without this, tests
      // that push synchronously then emit 'close' would resolve before data is
      // delivered to listeners.
      process.nextTick(() => {
        settle(() => {
          // Flush any trailing JSON in the buffer
          if (stdoutBuf.trim()) {
            const { lines } = takeCompleteLines(stdoutBuf + '\n')
            for (const line of lines) handleJsonEvent(line)
          }

          if (code !== 0 && code !== null) {
            reject(new TaggedError(`claude exited with code ${code}: ${stderr}`, 'cli-error'))
            return
          }

          // Prefer the full result.result if present (authoritative, includes the JSON fence);
          // otherwise fall back to the assembled text_delta buffer.
          resolve(resultFallback ?? textBuf)
        })
      })
    })

    // Swallow stdin write errors (e.g. child exits before consuming the prompt);
    // the 'close' / 'error' handlers drive rejection, so this just prevents
    // unhandled-error noise from a broken pipe.
    proc.stdin?.on('error', () => {})
    proc.stdin?.write(prompt)
    proc.stdin?.end()
  })
}

export async function callClaude(
  prompt: string,
  onEvent: OnStreamEvent = () => {}
): Promise<string> {
  return callClaudeWith(spawn, prompt, onEvent)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runAgentAction(
  request: AgentActionRequest,
  callClaudeFn: CallClaudeFn = callClaude,
  onStream: OnStreamEvent = () => {}
): Promise<AgentActionResponse> {
  try {
    onStream({ kind: 'phase', phase: 'starting' })

    const prompt = buildPrompt(request.action, request.context, request.userPrompt)
    const response = await callClaudeFn(prompt, onStream)

    let parsed: unknown
    try {
      parsed = extractJsonFromResponse(response)
    } catch {
      return { error: 'Agent returned invalid output. Try again.', tag: 'invalid-output' }
    }

    if (!isObj(parsed) || !Array.isArray((parsed as Record<string, unknown>).ops)) {
      return {
        error: 'Response JSON must contain an "ops" array',
        tag: 'invalid-output'
      }
    }

    const validation = validateAgentOps((parsed as Record<string, unknown>).ops)
    if (!validation.ok) {
      return { error: `Validation failed: ${validation.error}`, tag: 'invalid-output' }
    }

    const basePlan = buildPlanFromOps(validation.value)
    const plan = isClusterProducingAction(request.action)
      ? stampRootCardWithCluster(
          basePlan,
          newClusterId(),
          request.context.selectedCards.map((c) => c.id)
        )
      : basePlan
    onStream({ kind: 'phase', phase: 'materializing', count: plan.ops.length })
    return { plan }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const tag: AgentErrorTag = err instanceof TaggedError ? err.tag : 'invalid-output'
    return { error: message, tag }
  }
}
