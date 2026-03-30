import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'
import { type SessionId, sessionId } from '@shared/types'
import { TmuxService, type ReconnectResult, type DiscoveredSession } from './tmux-service'

export type DataCallback = (id: SessionId, data: string) => void
export type ExitCallback = (id: SessionId, code: number) => void

// ---------------------------------------------------------------------------
// ShellService: dual-path facade.
// Delegates to TmuxService when tmux >= 2.6 is available, otherwise falls
// back to ephemeral node-pty sessions that die with the app.
// ---------------------------------------------------------------------------

export class ShellService {
  private readonly tmux: TmuxService | null
  private readonly ephemeralSessions = new Map<SessionId, IPty>()
  private onData: DataCallback = () => {}
  private onExit: ExitCallback = () => {}

  constructor() {
    this.tmux = TmuxService.tryCreate()
  }

  /** Whether persistent tmux sessions are available. */
  get tmuxAvailable(): boolean {
    return this.tmux !== null
  }

  setCallbacks(onData: DataCallback, onExit: ExitCallback): void {
    this.onData = onData
    this.onExit = onExit
    this.tmux?.setCallbacks(
      (id, data) => onData(sessionId(id), data),
      (id, code) => onExit(sessionId(id), code)
    )
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  create(
    cwd: string,
    cols?: number,
    rows?: number,
    shell?: string,
    label?: string,
    vaultPath?: string
  ): SessionId {
    const id = sessionId(randomUUID())

    if (this.tmux) {
      this.tmux.create(id, cwd, cols, rows, shell, label, vaultPath)
      return id
    }

    // Ephemeral fallback
    return this.createEphemeral(id, cwd, shell)
  }

  // -----------------------------------------------------------------------
  // Reconnect (tmux only)
  // -----------------------------------------------------------------------

  reconnect(id: SessionId, cols: number, rows: number): ReconnectResult | null {
    if (!this.tmux) return null
    return this.tmux.reconnect(id, cols, rows)
  }

  // -----------------------------------------------------------------------
  // Discover (tmux only)
  // -----------------------------------------------------------------------

  discover(): DiscoveredSession[] {
    if (!this.tmux) return []
    return this.tmux.discover()
  }

  // -----------------------------------------------------------------------
  // Write / Resize / Kill
  // -----------------------------------------------------------------------

  write(id: SessionId, data: string): void {
    if (this.tmux) {
      this.tmux.write(id, data)
    } else {
      this.ephemeralSessions.get(id)?.write(data)
    }
  }

  resize(id: SessionId, cols: number, rows: number): void {
    if (this.tmux) {
      this.tmux.resize(id, cols, rows)
    } else {
      this.ephemeralSessions.get(id)?.resize(cols, rows)
    }
  }

  kill(id: SessionId): void {
    if (this.tmux) {
      this.tmux.kill(id)
    } else {
      this.ephemeralSessions.get(id)?.kill()
      this.ephemeralSessions.delete(id)
    }
  }

  getProcessName(id: SessionId): string | null {
    if (this.tmux) {
      return this.tmux.getProcessName(id)
    }
    return this.ephemeralSessions.get(id)?.process ?? null
  }

  // -----------------------------------------------------------------------
  // Shutdown vs KillAll
  // -----------------------------------------------------------------------

  /**
   * Graceful shutdown on app quit.
   * - Tmux: detach clients, sessions survive for reconnection.
   * - Ephemeral: kill all PTY sessions (nothing to reconnect to).
   */
  shutdown(): void {
    if (this.tmux) {
      this.tmux.detachAll()
    } else {
      this.killAllEphemeral()
    }
  }

  /**
   * Destroy everything. User-initiated "kill all sessions".
   * Kills both tmux sessions and ephemeral sessions.
   */
  killAll(): void {
    if (this.tmux) {
      this.tmux.killAll()
    }
    this.killAllEphemeral()
  }

  // -----------------------------------------------------------------------
  // Private: ephemeral node-pty
  // -----------------------------------------------------------------------

  private createEphemeral(id: SessionId, cwd: string, shell?: string): SessionId {
    const defaultShell = shell || process.env.SHELL || '/bin/zsh'

    const pty = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        PROMPT_EOL_MARK: ''
      }
    })

    pty.onData((data) => this.onData(id, data))
    pty.onExit(({ exitCode }) => {
      this.onExit(id, exitCode)
      this.ephemeralSessions.delete(id)
    })

    this.ephemeralSessions.set(id, pty)
    return id
  }

  private killAllEphemeral(): void {
    for (const [id, pty] of this.ephemeralSessions) {
      pty.kill()
      this.ephemeralSessions.delete(id)
    }
  }
}
