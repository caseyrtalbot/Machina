import { spawn, type IPty } from 'node-pty'
import { execFileSync } from 'child_process'
import { RingBuffer, DEFAULT_RING_BUFFER_BYTES } from './ring-buffer'
import { PtyWriteQueue, type PtyWrite } from './pty-write-queue'
import {
  getTerminfoDir,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  ensureSessionDir,
  getSessionDir,
  type SessionMeta
} from './session-paths'
import { readdirSync } from 'fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DataCallback = (sessionId: string, data: string) => void
type ExitCallback = (sessionId: string, code: number) => void

export interface ReconnectResult {
  readonly scrollback: string
  readonly meta: { shell: string; cwd: string; label?: string }
}

export interface DiscoveredSession {
  readonly sessionId: string
  readonly meta: SessionMeta
}

/** Cap reconnect queue to prevent unbounded memory growth while disconnected. */
const MAX_RECONNECT_QUEUE = 1000

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface ManagedSession {
  readonly pty: IPty
  readonly ringBuffer: RingBuffer
  readonly shell: string
  readonly cwd: string
  readonly label: string | undefined
  readonly vaultPath: string | undefined
  readonly createdAt: string
  readonly writeQueue: PtyWriteQueue
  connected: boolean
  reconnectQueue: string[]
}

// ---------------------------------------------------------------------------
// PtyService: manages node-pty sessions directly, no tmux.
// Sessions live in-process and survive webview teardown/recreation.
// ---------------------------------------------------------------------------

export class PtyService {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly closingSessions = new Map<string, boolean>()
  private onData: DataCallback = () => {}
  private onExit: ExitCallback = () => {}

  setCallbacks(onData: DataCallback, onExit: ExitCallback): void {
    this.onData = onData
    this.onExit = onExit
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  create(
    sessionId: string,
    cwd: string,
    cols?: number,
    rows?: number,
    shell?: string,
    label?: string,
    vaultPath?: string
  ): void {
    const defaultShell = shell || process.env.SHELL || '/bin/zsh'
    const c = cols || 80
    const r = rows || 24

    const ptyProcess = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: c,
      rows: r,
      cwd,
      env: buildEnv(sessionId)
    })

    const ringBuffer = new RingBuffer(DEFAULT_RING_BUFFER_BYTES)

    const session: ManagedSession = {
      pty: ptyProcess,
      ringBuffer,
      shell: defaultShell,
      cwd,
      label,
      vaultPath,
      createdAt: new Date().toISOString(),
      writeQueue: new PtyWriteQueue(),
      connected: true,
      reconnectQueue: []
    }

    this.sessions.set(sessionId, session)

    // Ring buffer always captures; callback fires only when connected.
    // Queue is capped to prevent unbounded growth while disconnected.
    ptyProcess.onData((data: string) => {
      ringBuffer.write(data)
      if (session.connected) {
        this.onData(sessionId, data)
      } else {
        session.reconnectQueue.push(data)
        if (session.reconnectQueue.length > MAX_RECONNECT_QUEUE) {
          session.reconnectQueue.shift()
        }
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId)
      deleteSessionMeta(sessionId)
      const shouldNotifyExit = this.closingSessions.get(sessionId) ?? true
      this.closingSessions.delete(sessionId)
      if (shouldNotifyExit) {
        this.onExit(sessionId, exitCode)
      }
    })

    // Persist metadata for discover-on-startup
    writeSessionMeta(sessionId, {
      shell: defaultShell,
      cwd,
      createdAt: session.createdAt,
      label,
      vaultPath
    })
  }

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------

  reconnect(sessionId: string, cols: number, rows: number): ReconnectResult | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      // Session is gone, clean up stale metadata
      deleteSessionMeta(sessionId)
      return null
    }

    // Capture scrollback from ring buffer
    const snapshotBuf = session.ringBuffer.snapshot()
    const scrollback = snapshotBuf.toString('utf-8')

    // Resize to match new webview dimensions
    try {
      session.pty.resize(cols, rows)
    } catch {
      // PTY may have exited between check and resize
    }

    // Flush any data that arrived while disconnected
    const queued = session.reconnectQueue
    session.reconnectQueue = []
    session.connected = true

    // Deliver queued data through the callback so the SessionRouter
    // can forward it to the newly registered webview
    for (const chunk of queued) {
      this.onData(sessionId, chunk)
    }

    return {
      scrollback,
      meta: {
        shell: session.shell,
        cwd: session.cwd,
        label: session.label
      }
    }
  }

  // -----------------------------------------------------------------------
  // Discover: find sessions with no active webview client
  // -----------------------------------------------------------------------

  discover(): DiscoveredSession[] {
    ensureSessionDir()
    const discovered: DiscoveredSession[] = []

    for (const [sessionId, session] of this.sessions) {
      if (session.connected) continue

      const meta = readSessionMeta(sessionId)
      if (!meta) continue

      discovered.push({ sessionId, meta })
    }

    // Clean up metadata for sessions that no longer exist in-process
    try {
      const metaFiles = readdirSync(getSessionDir())
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))

      for (const id of metaFiles) {
        if (!this.sessions.has(id)) {
          deleteSessionMeta(id)
        }
      }
    } catch {
      // Directory might not exist
    }

    return discovered
  }

  // -----------------------------------------------------------------------
  // Write / Resize / Kill
  // -----------------------------------------------------------------------

  /**
   * Enqueue a user command (typed in the prompt). Appends a carriage return
   * so the shell executes it. Drained through the per-session write queue.
   */
  write(sessionId: string, data: string): void {
    this.enqueueWrite(sessionId, { kind: 'bytes', data })
  }

  /** Enqueue raw bytes (e.g. control chars, escape sequences) for direct write. */
  sendRawKeys(sessionId: string, data: string): void {
    this.enqueueWrite(sessionId, { kind: 'bytes', data })
  }

  /**
   * Enqueue input originating from a CLI agent. Carries `mode` so future
   * arbitration policies can distinguish streamed token-by-token input
   * (don't interleave) from batched input (interleave with user OK).
   */
  writeAgentInput(
    sessionId: string,
    data: string,
    mode: 'streaming' | 'batched' = 'batched'
  ): void {
    this.enqueueWrite(sessionId, { kind: 'agent-input', mode, data })
  }

  /** Enqueue a typed write and kick the per-session drain. */
  private enqueueWrite(sessionId: string, write: PtyWrite): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.writeQueue.enqueue(write)
    void session.writeQueue.drain((w) => this.flushOne(session, w))
  }

  /** Apply one queued write to the underlying node-pty handle. */
  private flushOne(session: ManagedSession, write: PtyWrite): void {
    switch (write.kind) {
      case 'command':
        session.pty.write(`${write.text}\r`)
        return
      case 'bytes':
      case 'agent-input':
        session.pty.write(write.data)
        return
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    try {
      this.sessions.get(sessionId)?.pty.resize(cols, rows)
    } catch {
      // Session might have exited
    }
  }

  kill(sessionId: string, notifyExit = true): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    deleteSessionMeta(sessionId)
    this.closingSessions.set(sessionId, notifyExit)

    try {
      session.pty.kill()
    } catch {
      this.closingSessions.delete(sessionId)
      if (notifyExit) {
        this.onExit(sessionId, 0)
      }
    }
  }

  getProcessName(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    try {
      return (
        execFileSync('ps', ['-o', 'comm=', '-p', String(session.pty.pid)], {
          encoding: 'utf-8',
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim() || null
      )
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // Monitoring helpers
  // -----------------------------------------------------------------------

  getPid(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.pty.pid
  }

  getActiveSessions(): string[] {
    return [...this.sessions.keys()]
  }

  // -----------------------------------------------------------------------
  // Shutdown vs KillAll
  // -----------------------------------------------------------------------

  /**
   * Graceful shutdown on app quit.
   * Explicitly terminate PTYs so app exit does not rely on process teardown.
   */
  shutdown(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id, false)
    }
  }

  /**
   * Mark all sessions as disconnected without killing them.
   * Used by reconnect/discovery flows.
   */
  detachAll(): void {
    for (const session of this.sessions.values()) {
      session.connected = false
    }
  }

  /**
   * Destroy everything. User-initiated "kill all sessions".
   */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id, true)
    }
  }
}

// ---------------------------------------------------------------------------
// Environment builder
// ---------------------------------------------------------------------------

function buildEnv(sessionId: string): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }

  if (!env.LANG || !env.LANG.includes('UTF-8')) {
    env.LANG = 'en_US.UTF-8'
  }
  env.COLORTERM = 'truecolor'
  env.PROMPT_EOL_MARK = ''
  // Activates resources/shell-hooks/te.* — see docs/architecture/block-protocol.md.
  env.TE_SESSION_ID = sessionId

  const terminfoDir = getTerminfoDir()
  if (terminfoDir) {
    env.TERMINFO = terminfoDir
  }

  return env
}
