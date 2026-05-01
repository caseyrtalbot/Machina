export type DockTab =
  | { kind: 'canvas'; id: string }
  | { kind: 'editor'; path: string }
  | { kind: 'terminal'; sessionId: string }
  | { kind: 'graph' }
  | { kind: 'ghosts' }
  | { kind: 'health' }

export const DOCK_TAB_KINDS = ['canvas', 'editor', 'terminal', 'graph', 'ghosts', 'health'] as const

export type DockTabKind = (typeof DOCK_TAB_KINDS)[number]
