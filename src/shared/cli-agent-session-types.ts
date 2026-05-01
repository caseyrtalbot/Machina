/**
 * Wire types for the CLI agent session listener (Move 8).
 *
 * Shared so the renderer can type the IPC payload without dragging the
 * main-process listener implementation into the renderer bundle.
 */

export type CLIAgentSessionState = 'in-progress' | 'success' | 'blocked'

export interface CLIAgentSessionContext {
  readonly cwd: string | null
  readonly project: string | null
  readonly sessionId: string
  readonly toolName: string | null
  readonly toolInputPreview: string | null
  readonly summary: string | null
  readonly query: string | null
  readonly response: string | null
}

export interface CLIAgentSessionStatus {
  readonly agentId: string
  readonly sessionId: string
  readonly status: CLIAgentSessionState
  readonly context: CLIAgentSessionContext
}
