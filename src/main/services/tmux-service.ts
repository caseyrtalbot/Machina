import { spawn, type IPty } from 'node-pty'
import { readdirSync } from 'fs'
import {
  TMUX_SOCKET,
  SESSION_PREFIX,
  tmuxExec,
  tmuxSessionName,
  verifyTmuxAvailable,
  ensureSessionDir,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  getSessionDir,
  type SessionMeta
} from './tmux-paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataCallback = (sessionId: string, data: string) => void
export type ExitCallback = (sessionId: string, code: number) => void

export interface ReconnectResult {
  readonly scrollback: string
  readonly meta: { shell: string; cwd: string; label?: string }
}

export interface DiscoveredSession {
  readonly sessionId: string
  readonly meta: SessionMeta
}

// ---------------------------------------------------------------------------
// TmuxService: wraps every PTY in a tmux session on a dedicated socket.
// Sessions survive app quit/crash. Reconnect replays scrollback.
// ---------------------------------------------------------------------------

export class TmuxService {
  /** Active node-pty clients (one per attached tmux session). */
  private clients = new Map<string, IPty>()
  private onData: DataCallback = () => {}
  private onExit: ExitCallback = () => {}

  /**
   * Factory: returns a TmuxService if tmux >= 2.6 is available, otherwise null.
   * The caller falls back to ephemeral node-pty when null.
   */
  static tryCreate(): TmuxService | null {
    if (!verifyTmuxAvailable()) return null
    return new TmuxService()
  }

  setCallbacks(onData: DataCallback, onExit: ExitCallback): void {
    this.onData = onData
    this.onExit = onExit
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  create(sessionId: string, cwd: string, shell?: string, label?: string, vaultPath?: string): void {
    const defaultShell = shell || process.env.SHELL || '/bin/zsh'
    const name = tmuxSessionName(sessionId)

    // Create a detached tmux session with initial size
    tmuxExec('new-session', '-d', '-s', name, '-c', cwd, '-x', '80', '-y', '24', defaultShell)

    // Set generous scrollback limit and hide the status bar.
    // The status bar leaks tmux internals into the embedded terminal UI.
    tmuxExec('set-option', '-t', name, 'history-limit', '100000')
    tmuxExec('set-option', '-t', name, 'status', 'off')

    // Persist metadata
    writeSessionMeta(sessionId, {
      shell: defaultShell,
      cwd,
      createdAt: new Date().toISOString(),
      label,
      vaultPath
    })

    // Attach a node-pty client to pipe data to the renderer
    this.attachClient(sessionId, name)
  }

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------

  reconnect(sessionId: string, cols: number, rows: number): ReconnectResult | null {
    const name = tmuxSessionName(sessionId)

    // Verify the tmux session still exists
    try {
      tmuxExec('has-session', '-t', name)
    } catch {
      // Session is gone, clean up stale metadata
      deleteSessionMeta(sessionId)
      return null
    }

    const meta = readSessionMeta(sessionId)
    if (!meta) {
      // Metadata missing but session exists: kill the orphan
      this.killTmuxSession(name)
      return null
    }

    // Resize the tmux window to match the new terminal dimensions BEFORE attaching.
    // When the client attaches, tmux redraws the current screen at the correct size.
    // We skip scrollback replay because capture-pane captures at the OLD dimensions,
    // and ANSI escape codes with hardcoded cursor positions render as garbled dots
    // when replayed into a differently-sized xterm.
    try {
      tmuxExec('resize-window', '-t', name, '-x', String(cols), '-y', String(rows))
    } catch {
      // resize can fail if session has no window
    }

    // Attach a fresh client — tmux redraws the current pane content automatically
    this.attachClient(sessionId, name)

    return {
      scrollback: '',
      meta: { shell: meta.shell, cwd: meta.cwd, label: meta.label }
    }
  }

  // -----------------------------------------------------------------------
  // Discover: find surviving sessions on startup
  // -----------------------------------------------------------------------

  discover(): DiscoveredSession[] {
    ensureSessionDir()

    // Get live tmux sessions on our socket
    const liveSessions = this.listTmuxSessions()

    // Get metadata files
    const metaFiles = this.listMetaFiles()

    const discovered: DiscoveredSession[] = []
    const liveNames = new Set(liveSessions)

    // Match metadata files to live sessions
    for (const sessionId of metaFiles) {
      const name = tmuxSessionName(sessionId)
      if (!liveNames.has(name)) {
        // Stale metadata: tmux session is gone
        deleteSessionMeta(sessionId)
        continue
      }

      // Skip sessions that already have a client attached
      if (this.hasAttachedClients(name)) continue

      const meta = readSessionMeta(sessionId)
      if (!meta) {
        // Corrupted metadata: kill the orphan
        this.killTmuxSession(name)
        continue
      }

      discovered.push({ sessionId, meta })
      liveNames.delete(name)
    }

    // Kill orphan tmux sessions (te- prefix but no metadata file)
    for (const name of liveNames) {
      if (name.startsWith(SESSION_PREFIX)) {
        this.killTmuxSession(name)
      }
    }

    return discovered
  }

  // -----------------------------------------------------------------------
  // Write / Resize / Kill
  // -----------------------------------------------------------------------

  write(sessionId: string, data: string): void {
    this.clients.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const client = this.clients.get(sessionId)
    if (!client) return

    client.resize(cols, rows)

    // Also resize the tmux window so capture-pane reflects the new dimensions
    try {
      tmuxExec(
        'resize-window',
        '-t',
        tmuxSessionName(sessionId),
        '-x',
        String(cols),
        '-y',
        String(rows)
      )
    } catch {
      // Session might be gone
    }
  }

  kill(sessionId: string): void {
    // Kill the node-pty client
    const client = this.clients.get(sessionId)
    if (client) {
      client.kill()
      this.clients.delete(sessionId)
    }

    // Kill the tmux session
    this.killTmuxSession(tmuxSessionName(sessionId))

    // Delete metadata
    deleteSessionMeta(sessionId)
  }

  /**
   * Detach all node-pty clients but leave tmux sessions running.
   * Called on app quit so sessions survive for reconnection.
   */
  detachAll(): void {
    for (const [id, client] of this.clients) {
      client.kill()
      this.clients.delete(id)
    }
  }

  /**
   * Kill everything: all tmux sessions on our socket + all metadata.
   * Used for explicit user-initiated "destroy all sessions".
   */
  killAll(): void {
    // Kill all node-pty clients
    for (const [id, client] of this.clients) {
      client.kill()
      this.clients.delete(id)
    }

    // Kill the entire tmux server on our socket
    try {
      tmuxExec('kill-server')
    } catch {
      // Server might not be running
    }

    // Clean up all metadata files
    try {
      const dir = getSessionDir()
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        const sessionId = file.replace('.json', '')
        deleteSessionMeta(sessionId)
      }
    } catch {
      // Directory might not exist
    }
  }

  getProcessName(sessionId: string): string | null {
    const name = tmuxSessionName(sessionId)
    try {
      // Get the command of the active pane in the session
      const result = tmuxExec('display-message', '-t', name, '-p', '#{pane_current_command}')
      return result || null
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private attachClient(sessionId: string, tmuxName: string): void {
    // Kill any existing client for this session
    const existing = this.clients.get(sessionId)
    if (existing) {
      existing.kill()
      this.clients.delete(sessionId)
    }

    const pty = spawn('tmux', ['-L', TMUX_SOCKET, 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: {
        ...(process.env as Record<string, string>),
        PROMPT_EOL_MARK: ''
      }
    })

    pty.onData((data) => this.onData(sessionId, data))
    pty.onExit(({ exitCode }) => {
      this.clients.delete(sessionId)
      this.onExit(sessionId, exitCode)
    })

    this.clients.set(sessionId, pty)
  }

  private killTmuxSession(name: string): void {
    try {
      tmuxExec('kill-session', '-t', name)
    } catch {
      // Session already dead
    }
  }

  private listTmuxSessions(): string[] {
    try {
      const output = tmuxExec('list-sessions', '-F', '#{session_name}')
      return output.split('\n').filter(Boolean)
    } catch {
      // No server running
      return []
    }
  }

  private listMetaFiles(): string[] {
    try {
      return readdirSync(getSessionDir())
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
    } catch {
      return []
    }
  }

  private hasAttachedClients(tmuxName: string): boolean {
    try {
      const output = tmuxExec('list-clients', '-t', tmuxName, '-F', '#{client_name}')
      return output.length > 0
    } catch {
      return false
    }
  }
}
