export type DockTab =
  | { kind: 'canvas'; id: string }
  | { kind: 'editor'; path: string }
  | { kind: 'terminal'; sessionId: string }
  | { kind: 'graph' }
  | { kind: 'ghosts' }
  | { kind: 'health' }

export const DOCK_TAB_KINDS = ['canvas', 'editor', 'terminal', 'graph', 'ghosts', 'health'] as const

export type DockTabKind = (typeof DOCK_TAB_KINDS)[number]

// --- Terminal strip (workstation step 4) ---

export interface TerminalStripSession {
  /** Stable identity assigned at spawn; survives sessionId rebinds. */
  readonly tabId: string
  /** PTY session id — '' until the webview reports session-created. */
  readonly sessionId: string
  /** Working directory the session was spawned at (respawn target on relaunch). */
  readonly cwd: string
}

export interface TerminalStripState {
  readonly sessions: readonly TerminalStripSession[]
  readonly activeTabId: string | null
  readonly collapsed: boolean
  /** Pixel height of the expanded strip body. */
  readonly height: number
}

export const DEFAULT_TERMINAL_STRIP: TerminalStripState = {
  sessions: [],
  activeTabId: null,
  collapsed: false,
  height: 240
}
