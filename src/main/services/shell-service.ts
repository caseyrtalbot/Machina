import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'

export type DataCallback = (sessionId: string, data: string) => void
export type ExitCallback = (sessionId: string, code: number) => void

export class ShellService {
  private sessions = new Map<string, IPty>()
  private onData: DataCallback = () => {}
  private onExit: ExitCallback = () => {}

  setCallbacks(onData: DataCallback, onExit: ExitCallback): void {
    this.onData = onData
    this.onExit = onExit
  }

  create(cwd: string, shell?: string): string {
    const sessionId = randomUUID()
    const defaultShell = shell || process.env.SHELL || '/bin/zsh'

    const pty = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        // Disable zsh partial-line indicator (highlighted "%") on fresh spawn
        PROMPT_EOL_MARK: ''
      }
    })

    pty.onData((data) => this.onData(sessionId, data))
    pty.onExit(({ exitCode }) => {
      this.onExit(sessionId, exitCode)
      this.sessions.delete(sessionId)
    })

    this.sessions.set(sessionId, pty)
    return sessionId
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.resize(cols, rows)
  }

  kill(sessionId: string): void {
    this.sessions.get(sessionId)?.kill()
    this.sessions.delete(sessionId)
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }

  getProcessName(sessionId: string): string | null {
    const pty = this.sessions.get(sessionId)
    return pty?.process ?? null
  }
}
