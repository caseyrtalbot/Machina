import { randomUUID } from 'crypto'
import { type SessionId, sessionId } from '@shared/types'
import { PtyService, type ReconnectResult, type DiscoveredSession } from './pty-service'

type DataCallback = (id: SessionId, data: string) => void
type ExitCallback = (id: SessionId, code: number) => void

// ---------------------------------------------------------------------------
// ShellService: thin facade over PtyService.
// Provides branded SessionId and a stable public API for IPC consumers.
// ---------------------------------------------------------------------------

export class ShellService {
  private readonly pty: PtyService

  constructor() {
    this.pty = new PtyService()
  }

  /** Expose PtyService for monitoring (PtyMonitor needs direct access). */
  getPtyService(): PtyService {
    return this.pty
  }

  setCallbacks(onData: DataCallback, onExit: ExitCallback): void {
    this.pty.setCallbacks(
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
    this.pty.create(id, cwd, cols, rows, shell, label, vaultPath)
    return id
  }

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------

  reconnect(id: SessionId, cols: number, rows: number): ReconnectResult | null {
    return this.pty.reconnect(id, cols, rows)
  }

  // -----------------------------------------------------------------------
  // Discover
  // -----------------------------------------------------------------------

  discover(): DiscoveredSession[] {
    return this.pty.discover()
  }

  // -----------------------------------------------------------------------
  // Write / Resize / Kill
  // -----------------------------------------------------------------------

  write(id: SessionId, data: string): void {
    this.pty.write(id, data)
  }

  sendRawKeys(id: SessionId, data: string): void {
    this.pty.write(id, data)
  }

  resize(id: SessionId, cols: number, rows: number): void {
    this.pty.resize(id, cols, rows)
  }

  kill(id: SessionId): void {
    this.pty.kill(id)
  }

  getProcessName(id: SessionId): string | null {
    return this.pty.getProcessName(id)
  }

  // -----------------------------------------------------------------------
  // Shutdown vs KillAll
  // -----------------------------------------------------------------------

  /**
   * Graceful shutdown on app quit.
   * Terminates child PTYs explicitly so shutdown does not rely on process exit.
   */
  async shutdown(): Promise<void> {
    this.pty.shutdown()
  }

  /**
   * Destroy everything. User-initiated "kill all sessions".
   */
  killAll(): void {
    this.pty.killAll()
  }
}
