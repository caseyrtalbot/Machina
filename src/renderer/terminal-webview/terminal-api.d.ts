interface TerminalApi {
  create: (args: {
    cwd: string
    cols?: number
    rows?: number
    shell?: string
    label?: string
    vaultPath?: string
  }) => Promise<string>
  write: (args: { sessionId: string; data: string }) => Promise<void>
  resize: (args: { sessionId: string; cols: number; rows: number }) => Promise<void>
  kill: (args: { sessionId: string }) => Promise<void>
  reconnect: (args: {
    sessionId: string
    cols: number
    rows: number
  }) => Promise<{ scrollback: string; meta?: Record<string, string> } | null>
  onData: (cb: (data: { sessionId: string; data: string }) => void) => void
  offData: (cb: (data: { sessionId: string; data: string }) => void) => void
  onExit: (cb: (data: { sessionId: string; code: number }) => void) => void
  offExit: (cb: (data: { sessionId: string; code: number }) => void) => void
  onFocus: (cb: () => void) => void
  onBlur: (cb: () => void) => void
  sendToHost: (channel: string, ...args: unknown[]) => void
}

declare global {
  interface Window {
    terminalApi: TerminalApi
  }
}

export {}
