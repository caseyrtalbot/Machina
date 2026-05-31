import type { DockTab, DockTabKind } from '@shared/dock-types'
import type { NativeToolResult, ToolContext } from './context'

const DOCK_KINDS: readonly DockTabKind[] = [
  'canvas',
  'editor',
  'terminal',
  'graph',
  'ghosts',
  'health'
]

function buildDockTab(input: Record<string, unknown>): DockTab | { error: string } {
  const kind = typeof input.kind === 'string' ? input.kind : null
  if (!kind || !DOCK_KINDS.includes(kind as DockTabKind)) {
    return { error: `open_dock_tab: kind must be one of ${DOCK_KINDS.join('|')}` }
  }
  switch (kind as DockTabKind) {
    case 'canvas':
      return { kind: 'canvas', id: typeof input.canvasId === 'string' ? input.canvasId : 'default' }
    case 'editor':
      return { kind: 'editor', path: typeof input.path === 'string' ? input.path : '' }
    case 'terminal':
      return {
        kind: 'terminal',
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : ''
      }
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
  ctx.emitDockAction({ action: 'open', tab: built })
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
