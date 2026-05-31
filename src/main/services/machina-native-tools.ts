// Barrel for the in-app native agent's tool surface. The implementations live
// in ./machina-native-tools/{note,canvas,dock}-tools.ts; shared context (the
// approval map, ToolContext/NativeToolResult types, and the PathGuard-backed
// resolveInVault) lives in ./machina-native-tools/context.ts. This file owns
// only the callTool dispatcher and re-exports the approval lifecycle so the
// public surface (callTool / decideApproval / clearApproval) is unchanged.
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

export async function callTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<NativeToolResult> {
  switch (name) {
    case 'read_note': {
      const p = typeof input.path === 'string' ? input.path : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'read_note: missing path' } }
      }
      return readNote(p, ctx)
    }
    case 'list_vault': {
      const raw = input.globs
      const globs =
        Array.isArray(raw) && raw.every((g): g is string => typeof g === 'string')
          ? (raw as string[])
          : undefined
      return listVault(globs, ctx)
    }
    case 'search_vault': {
      const query = typeof input.query === 'string' ? input.query : null
      if (!query) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'search_vault: missing query' } }
      }
      const rawPaths = input.paths
      const paths =
        Array.isArray(rawPaths) && rawPaths.every((p): p is string => typeof p === 'string')
          ? (rawPaths as string[])
          : undefined
      return searchVault(query, paths, ctx)
    }
    case 'write_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const content = typeof input.content === 'string' ? input.content : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'write_note: missing path' } }
      }
      if (content == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'write_note: missing content' } }
      }
      return writeNote(p, content, ctx)
    }
    case 'edit_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const find = typeof input.find === 'string' ? input.find : null
      const replace = typeof input.replace === 'string' ? input.replace : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing path' } }
      }
      if (find == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing find' } }
      }
      if (replace == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing replace' } }
      }
      return editNote(p, find, replace, ctx)
    }
    case 'read_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!id) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'read_canvas: missing canvasId' } }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      return readCanvas(id, ctx)
    }
    case 'pin_to_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      const rawCard = input.card
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      if (!rawCard || typeof rawCard !== 'object') {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: missing card' }
        }
      }
      const c = rawCard as Record<string, unknown>
      const title = typeof c.title === 'string' ? c.title : null
      if (!title) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: card.title is required' }
        }
      }
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
      return pinToCanvas(id, { title, path: cardPath, content, position, refs }, ctx)
    }
    case 'unpin_from_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      const cardId = typeof input.cardId === 'string' ? input.cardId : null
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'unpin_from_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      if (!cardId) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'unpin_from_canvas: missing cardId' }
        }
      }
      return unpinFromCanvas(id, cardId, ctx)
    }
    case 'list_canvases':
      return listCanvases(ctx)
    case 'focus_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'focus_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      const rawVp = input.viewport
      if (!rawVp || typeof rawVp !== 'object') {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'focus_canvas: missing viewport' }
        }
      }
      const vp = rawVp as Record<string, unknown>
      if (
        typeof vp.x !== 'number' ||
        typeof vp.y !== 'number' ||
        typeof vp.zoom !== 'number' ||
        !Number.isFinite(vp.x) ||
        !Number.isFinite(vp.y) ||
        !Number.isFinite(vp.zoom)
      ) {
        return {
          ok: false,
          error: {
            code: 'IO_FATAL',
            message: 'focus_canvas: viewport.{x,y,zoom} must all be finite numbers'
          }
        }
      }
      return focusCanvas(id, { x: vp.x, y: vp.y, zoom: vp.zoom }, ctx)
    }
    case 'open_dock_tab':
      return openDockTab(input, ctx)
    case 'close_dock_tab':
      return closeDockTab(input, ctx)
    default:
      return { ok: false, error: { code: 'IO_FATAL', message: `unknown tool: ${name}` } }
  }
}
