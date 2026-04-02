import { spawn } from 'child_process'
import type { CanvasNodeType, CanvasSide } from '@shared/canvas-types'
import type { CanvasMutationOp, CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type {
  AgentActionName,
  AgentActionRequest,
  AgentActionResponse,
  AgentContext
} from '@shared/agent-action-types'
import type { Result } from '@shared/engine/types'

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

const CLI_TIMEOUT_MS = 60_000

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
    'add new cards unless absolutely necessary.'
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

export function buildPrompt(action: AgentActionName, context: AgentContext): string {
  const instructions = ACTION_INSTRUCTIONS[action]
  const cards = formatCards(context)
  const neighbors = formatNeighbors(context)
  const edges = formatEdges(context)
  const { viewportBounds, totalCardCount } = context.canvasMeta

  return `# Canvas Agent: ${action}

${instructions}

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

- {"type": "add-node", "node": {"id": "unique_id", "type": "text", "position": {"x": 0, "y": 0}, "size": {"width": 200, "height": 100}, "content": "...", "metadata": {}}}
- {"type": "add-edge", "edge": {"fromNode": "id", "toNode": "id", "fromSide": "bottom", "toSide": "top"}}
- {"type": "move-node", "nodeId": "id", "position": {"x": 0, "y": 0}}
- {"type": "resize-node", "nodeId": "id", "size": {"width": 200, "height": 100}}
- {"type": "remove-node", "nodeId": "id"}
- {"type": "remove-edge", "edgeId": "id"}

Valid node types: text, note, code, markdown, image, terminal, pdf, project-file, system-artifact, file-view, agent-session, project-folder.
Valid sides: top, right, bottom, left.

Wrap your JSON in a \`\`\`json code fence.`
}

// ---------------------------------------------------------------------------
// Claude CLI Caller (injectable for testing)
// ---------------------------------------------------------------------------

export type CallClaudeFn = (prompt: string) => Promise<string>

export async function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => reject(new Error(`Failed to spawn claude: ${err.message}`)))

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`))
      } else {
        resolve(stdout)
      }
    })

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`claude timed out after ${CLI_TIMEOUT_MS}ms`))
    }, CLI_TIMEOUT_MS)

    proc.on('close', () => clearTimeout(timeout))

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runAgentAction(
  request: AgentActionRequest,
  callClaudeFn: CallClaudeFn = callClaude
): Promise<AgentActionResponse> {
  try {
    const prompt = buildPrompt(request.action, request.context)
    const response = await callClaudeFn(prompt)
    const parsed = extractJsonFromResponse(response)

    if (!isObj(parsed) || !Array.isArray((parsed as Record<string, unknown>).ops)) {
      return { error: 'Response JSON must contain an "ops" array' }
    }

    const validation = validateAgentOps((parsed as Record<string, unknown>).ops)
    if (!validation.ok) {
      return { error: `Validation failed: ${validation.error}` }
    }

    const plan = buildPlanFromOps(validation.value)
    return { plan }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: message }
  }
}
