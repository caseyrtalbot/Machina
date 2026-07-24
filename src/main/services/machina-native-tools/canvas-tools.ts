import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvasNode } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { TE_DIR } from '@shared/constants'
import { PathGuardError } from '@shared/agent-types'
import { wrapSpotlighting } from '@shared/spotlighting'
import { applyCanvasPlanToFile, writeCanvasViewport } from '../canvas-apply'
import { resolveInVault, type NativeToolResult, type ToolContext } from './context'

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

// canvasId is validated by CANVAS_ID_RE at the barrel (callTool) as a fast first
// reject, then the computed path is routed through resolveInVault/PathGuard here
// so every canvas reader and writer inherits the symlink/traversal backstop —
// the regex alone can't catch a `.machina/canvas/<id>.json` that symlinks out of
// the vault. Returns a ResolveResult; callers must short-circuit on `!ok`.
function canvasFilePath(vault: string, canvasId: string): ReturnType<typeof resolveInVault> {
  const rel =
    canvasId === 'default'
      ? path.join(TE_DIR, 'canvas.json')
      : path.join(TE_DIR, 'canvas', `${canvasId}.json`)
  return resolveInVault(vault, rel)
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
  const resolved = canvasFilePath(ctx.vaultPath, canvasId)
  if (!resolved.ok) return resolved
  const file = resolved.abs
  try {
    // Route through the shared facade for the path-level audit the MCP twin
    // (canvas.get_snapshot) already leaves; canvasFilePath/CANVAS_ID_RE remains
    // the first barrier so a bad id is rejected before we touch the facade.
    ctx.facade.assertReadable(file, 'read_canvas')
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as CanvasFileShape
    // Canvas nodes/edges are untrusted vault content — Spotlight-wrap the whole
    // snapshot so the payload never reaches the LLM unwrapped. The renderer's
    // ReadCanvasCard unwraps + parses it back for display.
    const snapshot = wrapSpotlighting(
      'read_canvas',
      canvasId,
      JSON.stringify({
        version: typeof parsed.version === 'number' ? parsed.version : undefined,
        viewport: parsed.viewport ?? null,
        cards: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : []
      })
    )
    return { ok: true, output: { canvasId, snapshot } }
  } catch (err) {
    if (err instanceof PathGuardError) {
      return { ok: false, error: { code: 'PATH_OUT_OF_VAULT', message: err.message } }
    }
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
  const resolved = canvasFilePath(ctx.vaultPath, canvasId)
  if (!resolved.ok) return resolved
  const file = resolved.abs
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

  const plan = buildAgentPlan([{ type: 'add-node', node }], {
    ...EMPTY_PLAN_SUMMARY,
    addedNodes: 1
  })
  const applied = await applyCanvasPlanToFile(file, plan)
  if (!applied.ok) {
    if (applied.error === 'not-found') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: applied.message } }
  }
  ctx.audit?.log({
    ts: new Date().toISOString(),
    tool: 'pin_to_canvas',
    args: { canvasId, cardId: node.id },
    affectedPaths: [path.relative(ctx.vaultPath, file)],
    decision: 'allowed'
  })
  ctx.dispatchCanvasPlan?.(plan, file)
  return { ok: true, output: { cardId: node.id, canvasId, node } }
}

export async function unpinFromCanvas(
  canvasId: string,
  cardId: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const resolved = canvasFilePath(ctx.vaultPath, canvasId)
  if (!resolved.ok) return resolved
  const file = resolved.abs
  // remove-node in applyPlanOps cascades to drop edges that reference the card,
  // so the plan carries only the node removal. validateCanvasMutationOps rejects
  // a remove-node for an id that isn't present, which is exactly the
  // CARD_NOT_FOUND condition — the only op here is this removal, so a validation
  // failure means the card was missing.
  const plan = buildAgentPlan([{ type: 'remove-node', nodeId: cardId }], EMPTY_PLAN_SUMMARY)
  const applied = await applyCanvasPlanToFile(file, plan)
  if (!applied.ok) {
    if (applied.error === 'not-found') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    if (applied.error === 'validation') {
      return { ok: false, error: { code: 'CARD_NOT_FOUND', message: cardId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: applied.message } }
  }
  ctx.audit?.log({
    ts: new Date().toISOString(),
    tool: 'unpin_from_canvas',
    args: { canvasId, cardId },
    affectedPaths: [path.relative(ctx.vaultPath, file)],
    decision: 'allowed'
  })
  ctx.dispatchCanvasPlan?.(plan, file)
  return { ok: true, output: { cardId, canvasId } }
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
  const resolved = canvasFilePath(ctx.vaultPath, canvasId)
  if (!resolved.ok) return resolved
  const file = resolved.abs
  // Viewport is not a mutation op (no viewport op exists, by design), so focus
  // does not build a plan; its file write is serialized on the shared per-file
  // queue via writeCanvasViewport so ALL canvas file writes live in one module.
  const written = await writeCanvasViewport(file, viewport)
  if (!written.ok) {
    if (written.error === 'not-found') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: written.message } }
  }
  ctx.audit?.log({
    ts: new Date().toISOString(),
    tool: 'focus_canvas',
    args: { canvasId },
    affectedPaths: [path.relative(ctx.vaultPath, file)],
    decision: 'allowed'
  })
  return { ok: true, output: { canvasId, viewport } }
}
