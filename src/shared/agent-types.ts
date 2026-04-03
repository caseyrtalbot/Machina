/**
 * Type definitions for the agent/security system.
 *
 * Shared between main and renderer processes. Contains security-related
 * types used by PathGuard and AuditLogger.
 */

/** Structured error thrown when a path violates vault boundaries or deny rules. */
export class PathGuardError extends Error {
  readonly attemptedPath: string
  readonly vaultRoot: string

  constructor(attemptedPath: string, vaultRoot: string, reason?: string) {
    const message = reason
      ? `Path guard violation: ${reason}`
      : `Path "${attemptedPath}" is outside vault boundary "${vaultRoot}"`
    super(message)
    this.name = 'PathGuardError'
    this.attemptedPath = attemptedPath
    this.vaultRoot = vaultRoot
  }
}

/** Session status for an agent visibility card. */
export type AgentSessionStatus = 'active' | 'idle' | 'completed'

/** Data backing an agent session card on the canvas. */
export interface AgentSessionCardData {
  readonly sessionId: string
  readonly status: AgentSessionStatus
  readonly filesTouched: readonly string[]
  readonly startedAt: number
  readonly lastActivity: number
}

// ---------------------------------------------------------------------------
// Sidecar monitoring types
// ---------------------------------------------------------------------------

/** Optional data written by an agent process to .te/agents/<id>.json */
export interface AgentSidecar {
  readonly filesTouched: readonly string[]
  readonly currentTask?: string
  /** e.g. "claude-code", "codex", "gemini" */
  readonly agentType?: string
}

/** Snapshot of one agent session as seen by TmuxMonitor. */
export interface AgentSidecarState {
  readonly sessionId: string
  /** e.g. "te-abc123" */
  readonly tmuxName: string
  readonly status: 'alive' | 'idle' | 'exited'
  /** tmux pane PID */
  readonly pid?: number
  /** from tmux pane_current_command */
  readonly currentCommand?: string
  /** ISO from session metadata */
  readonly startedAt?: string
  /** ISO, updated on status change */
  readonly lastActivity?: string
  /** from session metadata */
  readonly label?: string
  /** from session metadata */
  readonly cwd?: string
  /** Sidecar-provided (only if .te/agents/<id>.json exists) */
  readonly sidecar?: AgentSidecar
}

// ---------------------------------------------------------------------------
// Agent spawn types
// ---------------------------------------------------------------------------

/** Full configuration for spawning an agent process. */
export interface AgentSpawnConfig {
  readonly sessionId: string
  readonly vaultRoot: string
  readonly cwd: string
  readonly prompt?: string
}

/** IPC request shape for spawning an agent (sessionId and vaultRoot added by main). */
export interface AgentSpawnRequest {
  readonly cwd: string
  readonly prompt?: string
  readonly type?: 'librarian' | 'curator'
  readonly curatorMode?: string
}

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

/** A single audit log entry for security-relevant operations. */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  readonly ts: string
  /** IPC channel or MCP tool name, e.g. 'vault:read-file' */
  readonly tool: string
  /** Arguments passed to the tool */
  readonly args: Readonly<Record<string, unknown>>
  /** File paths affected by the operation */
  readonly affectedPaths: readonly string[]
  /** Whether the operation was permitted */
  readonly decision: 'allowed' | 'denied' | 'error'
  /** Time taken in milliseconds */
  readonly durationMs?: number
  /** Error message if decision is 'denied' or 'error' */
  readonly error?: string
}
