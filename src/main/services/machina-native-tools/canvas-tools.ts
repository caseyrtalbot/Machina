import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvasNode } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { TE_DIR } from '@shared/constants'
import { enqueueCanvasWrite } from '../canvas-write-queue'
import type { NativeToolResult, ToolContext } from './context'

export const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/

interface CanvasFileShape {
  nodes?: unknown[]
  edges?: unknown[]
  viewport?: unknown
  version?: number
  [k: string]: unknown
}

interface PinCardInput {
  readonly title: string
  readonly path?: string
  readonly content?: string
  readonly position?: { x: number; y: number }
  readonly refs?: readonly string[]
}

// Canvas writes do not go through resolveInVault/PathGuard — the CANVAS_ID_RE
// check at the barrel (callTool) IS the boundary, structurally confining the
// path to .machina/canvas/<id>.json. Do not loosen CANVAS_ID_RE (e.g. to allow
// '/' for nested canvases) without routing these writes through resolveInVault,
// or the canvas path loses its symlink/traversal backstop.
function canvasFilePath(vault: string, canvasId: string): string {
  if (canvasId === 'default') return path.join(vault, TE_DIR, 'canvas.json')
  return path.join(vault, TE_DIR, 'canvas', `${canvasId}.json`)
}

function buildAgentPlan(
  ops: CanvasMutationPlan['ops'],
  summary: CanvasMutationPlan['summary']
): CanvasMutationPlan {
  return {
    id: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    operationId: `agent_${Date.now().toString(36)}`,
    source: 'agent',
    ops,
    summary
  }
}

const EMPTY_PLAN_SUMMARY: CanvasMutationPlan['summary'] = {
  addedNodes: 0,
  addedEdges: 0,
  movedNodes: 0,
  skippedFiles: 0,
  unresolvedRefs: 0
}

export async function readCanvas(canvasId: string, ctx: ToolContext): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as CanvasFileShape
    return {
      ok: true,
      output: {
        canvasId,
        version: typeof parsed.version === 'number' ? parsed.version : undefined,
        viewport: parsed.viewport ?? null,
        cards: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : []
      }
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
  }
}

export async function pinToCanvas(
  canvasId: string,
  card: PinCardInput,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  return enqueueCanvasWrite(file, async () => {
    let canvas: CanvasFileShape
    try {
      canvas = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
      }
      return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
    }
    // Three pin shapes:
    //   1. path set → pin a `note` card pointing at the vault file. The
    //      canvas renderer reads the .md off disk and renders the actual
    //      note with full markdown formatting (this is the canonical way
    //      to pin existing vault content).
    //   2. content set → pin a `markdown` card with the agent-authored
    //      body so headings/bold/lists/wikilinks all render rich.
    //   3. neither → pin a `markdown` card with just the title.
    // Older `text` cards rendered as raw plaintext, which surfaced literal
    // `## heading` and `**bold**` markers when the agent passed markdown.
    const pos = { x: card.position?.x ?? 0, y: card.position?.y ?? 0 }
    const refs = card.refs ?? []
    const node = card.path
      ? createCanvasNode('note', pos, {
          content: card.path,
          metadata: { refs }
        })
      : (() => {
          const body = card.content ?? ''
          const text = body ? `# ${card.title}\n\n${body}` : `# ${card.title}`
          return createCanvasNode('markdown', pos, {
            content: text,
            metadata: { viewMode: 'rendered', refs }
          })
        })()
    const nodes = Array.isArray(canvas.nodes) ? [...canvas.nodes, node] : [node]
    const next: CanvasFileShape = { ...canvas, nodes }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      ctx.audit?.log({
        ts: new Date().toISOString(),
        tool: 'pin_to_canvas',
        args: { canvasId, cardId: node.id },
        affectedPaths: [path.relative(ctx.vaultPath, file)],
        decision: 'allowed'
      })
      ctx.dispatchCanvasPlan?.(
        buildAgentPlan([{ type: 'add-node', node }], { ...EMPTY_PLAN_SUMMARY, addedNodes: 1 }),
        file
      )
      return { ok: true, output: { cardId: node.id, canvasId, node } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
}

export async function unpinFromCanvas(
  canvasId: string,
  cardId: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  return enqueueCanvasWrite(file, async () => {
    let canvas: CanvasFileShape
    try {
      canvas = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
      }
      return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
    }
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
    const idx = nodes.findIndex(
      (n): n is { id: string } =>
        n != null &&
        typeof n === 'object' &&
        typeof (n as { id?: unknown }).id === 'string' &&
        (n as { id: string }).id === cardId
    )
    if (idx === -1) {
      return { ok: false, error: { code: 'CARD_NOT_FOUND', message: cardId } }
    }
    const nextNodes = [...nodes.slice(0, idx), ...nodes.slice(idx + 1)]
    // Drop edges that reference the removed card so the file stays consistent.
    const edges = Array.isArray(canvas.edges) ? canvas.edges : []
    const nextEdges = edges.filter((e) => {
      if (!e || typeof e !== 'object') return true
      const rec = e as Record<string, unknown>
      return rec.from !== cardId && rec.to !== cardId
    })
    const next: CanvasFileShape = { ...canvas, nodes: nextNodes, edges: nextEdges }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      ctx.audit?.log({
        ts: new Date().toISOString(),
        tool: 'unpin_from_canvas',
        args: { canvasId, cardId },
        affectedPaths: [path.relative(ctx.vaultPath, file)],
        decision: 'allowed'
      })
      // remove-node in applyPlanOps cascades to drop matching edges, so we
      // do not need to enumerate removed edges in the plan ops.
      ctx.dispatchCanvasPlan?.(
        buildAgentPlan([{ type: 'remove-node', nodeId: cardId }], EMPTY_PLAN_SUMMARY),
        file
      )
      return { ok: true, output: { cardId, canvasId } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
}

export async function listCanvases(ctx: ToolContext): Promise<NativeToolResult> {
  interface CanvasEntry {
    canvasId: string
    cardCount: number
  }
  const entries: CanvasEntry[] = []

  async function countNodes(file: string): Promise<number | null> {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as CanvasFileShape
      return Array.isArray(parsed.nodes) ? parsed.nodes.length : 0
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return null
      // Treat unreadable canvases as 0 cards rather than failing the whole list.
      return 0
    }
  }

  const defaultFile = path.join(ctx.vaultPath, TE_DIR, 'canvas.json')
  const defaultCount = await countNodes(defaultFile)
  if (defaultCount !== null) {
    entries.push({ canvasId: 'default', cardCount: defaultCount })
  }

  const dir = path.join(ctx.vaultPath, TE_DIR, 'canvas')
  let names: string[] = []
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
    }
  }
  const ids = names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -'.json'.length))
    .filter((id) => CANVAS_ID_RE.test(id))
    .sort()
  for (const id of ids) {
    const file = path.join(dir, `${id}.json`)
    const count = await countNodes(file)
    if (count !== null) entries.push({ canvasId: id, cardCount: count })
  }
  return { ok: true, output: { canvases: entries } }
}

export async function focusCanvas(
  canvasId: string,
  viewport: { x: number; y: number; zoom: number },
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  return enqueueCanvasWrite(file, async () => {
    let canvas: CanvasFileShape
    try {
      canvas = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
      }
      return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
    }
    const next: CanvasFileShape = { ...canvas, viewport }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      ctx.audit?.log({
        ts: new Date().toISOString(),
        tool: 'focus_canvas',
        args: { canvasId },
        affectedPaths: [path.relative(ctx.vaultPath, file)],
        decision: 'allowed'
      })
      return { ok: true, output: { canvasId, viewport } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
}
