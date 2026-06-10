// Barrel for the in-app native agent's tool surface. The implementations live
// in ./machina-native-tools/{note,canvas,dock}-tools.ts; shared context (the
// approval map, ToolContext/NativeToolResult types, and the PathGuard-backed
// resolveInVault) lives in ./machina-native-tools/context.ts. This file owns
// only the callTool dispatcher and re-exports the approval lifecycle.
//
// callTool returns `{ result, call }`: the dispatcher already validates every
// input, so it also derives the persisted ToolCall from that validated input —
// this replaced the agent's duplicated ~115-line asToolCall re-validator (2.2).
// `call` is null for tools that aren't persisted to the thread transcript
// (dock tools, unknown tools) and for inputs that failed shape validation.
// (A single Zod definition per tool generating both the NATIVE_TOOLS schema
// and the ToolCall union was considered and deferred — it would churn the
// shared schema surface for no behavior change.)
import type { ToolCall } from '@shared/thread-types'
import type { NativeToolResult, ToolContext } from './machina-native-tools/context'
import {
  editNote,
  listVault,
  readNote,
  searchVault,
  writeNote
} from './machina-native-tools/note-tools'
import {
  CANVAS_ID_RE,
  focusCanvas,
  listCanvases,
  pinToCanvas,
  readCanvas,
  unpinFromCanvas
} from './machina-native-tools/canvas-tools'
import { closeDockTab, openDockTab } from './machina-native-tools/dock-tools'

export { decideApproval, clearApproval } from './machina-native-tools/context'

export interface NativeToolOutcome {
  readonly result: NativeToolResult
  readonly call: ToolCall | null
}

function fail(message: string, call: ToolCall | null = null): NativeToolOutcome {
  return { result: { ok: false, error: { code: 'IO_FATAL', message } }, call }
}

function badCanvasId(id: string, call: ToolCall | null = null): NativeToolOutcome {
  return {
    result: { ok: false, error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` } },
    call
  }
}

export async function callTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<NativeToolOutcome> {
  const id = ctx.toolUseId ?? ''
  switch (name) {
    case 'read_note': {
      const p = typeof input.path === 'string' ? input.path : null
      if (!p) return fail('read_note: missing path')
      const call: ToolCall = { id, kind: 'read_note', args: { path: p } }
      return { result: await readNote(p, ctx), call }
    }
    case 'list_vault': {
      const raw = input.globs
      const globs =
        Array.isArray(raw) && raw.every((g): g is string => typeof g === 'string')
          ? (raw as string[])
          : undefined
      const call: ToolCall = { id, kind: 'list_vault', args: globs ? { globs } : {} }
      return { result: await listVault(globs, ctx), call }
    }
    case 'search_vault': {
      const query = typeof input.query === 'string' ? input.query : null
      if (!query) return fail('search_vault: missing query')
      const rawPaths = input.paths
      const paths =
        Array.isArray(rawPaths) && rawPaths.every((p): p is string => typeof p === 'string')
          ? (rawPaths as string[])
          : undefined
      const call: ToolCall = {
        id,
        kind: 'search_vault',
        args: paths ? { query, paths } : { query }
      }
      return { result: await searchVault(query, paths, ctx), call }
    }
    case 'write_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const content = typeof input.content === 'string' ? input.content : null
      if (!p) return fail('write_note: missing path')
      if (content == null) return fail('write_note: missing content')
      const call: ToolCall = { id, kind: 'write_note', args: { path: p, content } }
      return { result: await writeNote(p, content, ctx), call }
    }
    case 'edit_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const find = typeof input.find === 'string' ? input.find : null
      const replace = typeof input.replace === 'string' ? input.replace : null
      if (!p) return fail('edit_note: missing path')
      if (find == null) return fail('edit_note: missing find')
      if (replace == null) return fail('edit_note: missing replace')
      const call: ToolCall = { id, kind: 'edit_note', args: { path: p, find, replace } }
      return { result: await editNote(p, find, replace, ctx), call }
    }
    case 'read_canvas': {
      const canvasId = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!canvasId) return fail('read_canvas: missing canvasId')
      const call: ToolCall = { id, kind: 'read_canvas', args: { canvasId } }
      if (!CANVAS_ID_RE.test(canvasId)) return badCanvasId(canvasId, call)
      return { result: await readCanvas(canvasId, ctx), call }
    }
    case 'pin_to_canvas': {
      const canvasId = typeof input.canvasId === 'string' ? input.canvasId : null
      const rawCard = input.card
      if (!canvasId) return fail('pin_to_canvas: missing canvasId')
      if (!rawCard || typeof rawCard !== 'object') return fail('pin_to_canvas: missing card')
      const c = rawCard as Record<string, unknown>
      const title = typeof c.title === 'string' ? c.title : null
      if (!title) return fail('pin_to_canvas: card.title is required')
      const cardPath = typeof c.path === 'string' ? c.path : undefined
      const content = typeof c.content === 'string' ? c.content : undefined
      const rawPos = c.position
      let position: { x: number; y: number } | undefined
      if (rawPos && typeof rawPos === 'object') {
        const pos = rawPos as Record<string, unknown>
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
          position = { x: pos.x, y: pos.y }
        }
      }
      const rawRefs = c.refs
      const refs =
        Array.isArray(rawRefs) && rawRefs.every((r): r is string => typeof r === 'string')
          ? (rawRefs as string[])
          : undefined
      const call: ToolCall = {
        id,
        kind: 'pin_to_canvas',
        args: {
          canvasId,
          card: {
            title,
            ...(cardPath !== undefined ? { path: cardPath } : {}),
            ...(content !== undefined ? { content } : {}),
            ...(position ? { position } : {}),
            ...(refs ? { refs } : {})
          }
        }
      }
      if (!CANVAS_ID_RE.test(canvasId)) return badCanvasId(canvasId, call)
      return {
        result: await pinToCanvas(
          canvasId,
          { title, path: cardPath, content, position, refs },
          ctx
        ),
        call
      }
    }
    case 'unpin_from_canvas': {
      const canvasId = typeof input.canvasId === 'string' ? input.canvasId : null
      const cardId = typeof input.cardId === 'string' ? input.cardId : null
      if (!canvasId) return fail('unpin_from_canvas: missing canvasId')
      if (!cardId) return fail('unpin_from_canvas: missing cardId')
      const call: ToolCall = { id, kind: 'unpin_from_canvas', args: { canvasId, cardId } }
      if (!CANVAS_ID_RE.test(canvasId)) return badCanvasId(canvasId, call)
      return { result: await unpinFromCanvas(canvasId, cardId, ctx), call }
    }
    case 'list_canvases': {
      const call: ToolCall = { id, kind: 'list_canvases', args: {} }
      return { result: await listCanvases(ctx), call }
    }
    case 'focus_canvas': {
      const canvasId = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!canvasId) return fail('focus_canvas: missing canvasId')
      const rawVp = input.viewport
      if (!rawVp || typeof rawVp !== 'object') return fail('focus_canvas: missing viewport')
      const vp = rawVp as Record<string, unknown>
      if (
        typeof vp.x !== 'number' ||
        typeof vp.y !== 'number' ||
        typeof vp.zoom !== 'number' ||
        !Number.isFinite(vp.x) ||
        !Number.isFinite(vp.y) ||
        !Number.isFinite(vp.zoom)
      ) {
        return fail('focus_canvas: viewport.{x,y,zoom} must all be finite numbers')
      }
      const viewport = { x: vp.x, y: vp.y, zoom: vp.zoom }
      const call: ToolCall = { id, kind: 'focus_canvas', args: { canvasId, viewport } }
      if (!CANVAS_ID_RE.test(canvasId)) return badCanvasId(canvasId, call)
      return { result: await focusCanvas(canvasId, viewport, ctx), call }
    }
    case 'open_dock_tab':
      return { result: await openDockTab(input, ctx), call: null }
    case 'close_dock_tab':
      return { result: await closeDockTab(input, ctx), call: null }
    default:
      return fail(`unknown tool: ${name}`)
  }
}
