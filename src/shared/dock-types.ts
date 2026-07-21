// The `kind: 'terminal'` variant is RETIRED (workstation Phase 3 step 3,
// contracts §3): the dock home for plain terminals is the terminal strip; for
// agent sessions it is ThreadPanel's agent surface. It was wired but never
// user-openable, and a dock terminal tab leaked its PTY on close.
// The `kind: 'editor'` variant is kind-keyed (no path): the dock holds ONE
// editor surface, and note identity lives only in editor-store (openTabs /
// activeNotePath). Per-path editor tabs were retired after they co-mounted
// N editor surfaces that all read the single global activeNotePath and
// corrupted each other. Legacy `{ kind: 'editor', path }` tabs from old
// thread files are folded at the dock-store seed boundary.
// `canvas` is the ONE variant that carries an `id` (Phase 1 step 4, plan of
// record): multiple canvases are real — each id keys its own store instance in
// the canvas-store registry, so two canvas tabs are two documents. Every other
// surface is a kind-keyed singleton; do not add ids to them.
export type DockTab =
  | { kind: 'canvas'; id: string }
  | { kind: 'editor' }
  | { kind: 'graph' }
  | { kind: 'ghosts' }
  | { kind: 'health' }

export const DOCK_TAB_KINDS = ['canvas', 'editor', 'graph', 'ghosts', 'health'] as const

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
