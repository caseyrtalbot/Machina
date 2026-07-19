import { DOCK_TAB_KINDS } from '@shared/dock-types'
import type { DockTab, DockTabKind } from '@shared/dock-types'
import type { NativeToolResult, ToolContext } from './context'

function buildDockTab(input: Record<string, unknown>): DockTab | { error: string } {
  const kind = typeof input.kind === 'string' ? input.kind : null
  if (!kind || !DOCK_TAB_KINDS.includes(kind as DockTabKind)) {
    return { error: `open_dock_tab: kind must be one of ${DOCK_TAB_KINDS.join('|')}` }
  }
  switch (kind as DockTabKind) {
    case 'canvas':
      return { kind: 'canvas', id: typeof input.canvasId === 'string' ? input.canvasId : 'default' }
    case 'editor':
      // Kind-keyed singleton — the note path travels as DockAction.notePath.
      return { kind: 'editor' }
    default:
      return { kind: kind as 'graph' | 'ghosts' | 'health' }
  }
}

export function openDockTab(input: Record<string, unknown>, ctx: ToolContext): NativeToolResult {
  if (!ctx.emitDockAction) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'dock action channel unavailable' } }
  }
  const built = buildDockTab(input)
  if ('error' in built) {
    return { ok: false, error: { code: 'IO_FATAL', message: built.error } }
  }
  const notePath =
    built.kind === 'editor' && typeof input.path === 'string' && input.path !== ''
      ? input.path
      : undefined
  ctx.emitDockAction(
    notePath ? { action: 'open', tab: built, notePath } : { action: 'open', tab: built }
  )
  const index = ctx.dockTabsSnapshot ? ctx.dockTabsSnapshot.length : null
  return { ok: true, output: { opened: built, index } }
}

export function closeDockTab(input: Record<string, unknown>, ctx: ToolContext): NativeToolResult {
  if (!ctx.emitDockAction) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'dock action channel unavailable' } }
  }
  const tabs = ctx.dockTabsSnapshot ?? []
  let target: number | null = null
  if (typeof input.index === 'number' && Number.isInteger(input.index)) {
    target = input.index
  } else if (typeof input.kind === 'string') {
    const kind = input.kind as DockTabKind
    target = tabs.findIndex((t) => t.kind === kind)
    if (target < 0) target = null
  }
  if (target === null) {
    return { ok: true, output: { closed: null, reason: 'no matching tab' } }
  }
  if (target < 0 || target >= tabs.length) {
    return {
      ok: false,
      error: { code: 'IO_FATAL', message: `close_dock_tab: index ${target} out of range` }
    }
  }
  ctx.emitDockAction({ action: 'close', index: target })
  return { ok: true, output: { closed: target } }
}
