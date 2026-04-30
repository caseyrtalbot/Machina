import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AgentSidecarState, AgentSidecar } from '@shared/agent-types'
import { readSessionMeta } from './session-paths'
import type { PtyService } from './pty-service'

/** Shell commands that indicate an idle (waiting for input) session. */
const KNOWN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', '-bash', '-zsh', '-fish', '-sh'])

const DEFAULT_POLL_INTERVAL_MS = 3000

/**
 * Polls PTY sessions and builds AgentSidecarState snapshots.
 * Uses PtyService for session info and batched ps for process detection.
 */
export class PtyMonitor {
  private readonly vaultRoot: string
  private readonly ptyService: PtyService
  private readonly pollIntervalMs: number
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private previousSnapshot: string | null = null

  constructor(vaultRoot: string, ptyService: PtyService, pollIntervalMs?: number) {
    this.vaultRoot = vaultRoot
    this.ptyService = ptyService
    this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  /** Get current agent states (one-shot, no polling). */
  getAgentStates(): AgentSidecarState[] {
    const sessionIds = this.ptyService.getActiveSessions()
    if (sessionIds.length === 0) return []

    // Batch-resolve process names in a single ps call
    const pidMap = new Map<number, string>()
    for (const id of sessionIds) {
      const pid = this.ptyService.getPid(id)
      if (pid !== undefined) pidMap.set(pid, id)
    }
    const commandMap = this.batchGetProcessNames([...pidMap.keys()])

    return sessionIds.map((sessionId) => {
      const pid = this.ptyService.getPid(sessionId)
      const currentCommand = pid !== undefined ? commandMap.get(pid) : undefined
      const meta = readSessionMeta(sessionId)
      const sidecar = this.readSidecar(sessionId)
      const status = this.deriveStatus(currentCommand)

      return {
        sessionId,
        displayName: `te-${sessionId}`,
        status,
        ...(pid !== undefined ? { pid } : {}),
        ...(currentCommand ? { currentCommand } : {}),
        ...(meta
          ? {
              startedAt: meta.createdAt,
              label: meta.label,
              cwd: meta.cwd
            }
          : {}),
        ...(sidecar ? { sidecar } : {})
      }
    })
  }

  /** Start polling. Calls onChange when state differs from previous poll. */
  start(onChange: (states: AgentSidecarState[]) => void): void {
    this.stop()
    this.previousSnapshot = null
    const poll = (): void => {
      const states = this.getAgentStates()
      const snapshot = JSON.stringify(states)
      if (snapshot !== this.previousSnapshot) {
        this.previousSnapshot = snapshot
        onChange(states)
      }
    }
    poll()
    this.pollTimer = setInterval(poll, this.pollIntervalMs)
  }

  /** Stop polling. */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private deriveStatus(currentCommand?: string): AgentSidecarState['status'] {
    if (!currentCommand) return 'alive'
    return KNOWN_SHELLS.has(currentCommand) ? 'idle' : 'alive'
  }

  /** Batch-resolve process names for multiple PIDs in a single ps call. */
  private batchGetProcessNames(pids: number[]): Map<number, string> {
    const result = new Map<number, string>()
    if (pids.length === 0) return result

    try {
      const output = execFileSync('ps', ['-o', 'pid=,comm=', '-p', pids.join(',')], {
        encoding: 'utf-8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()

      for (const line of output.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const spaceIdx = trimmed.indexOf(' ')
        if (spaceIdx === -1) continue
        const pid = parseInt(trimmed.slice(0, spaceIdx), 10)
        const comm = trimmed.slice(spaceIdx + 1).trim()
        if (!isNaN(pid) && comm) result.set(pid, comm)
      }
    } catch {
      // All processes may have exited
    }

    return result
  }

  /** Read optional sidecar file at <vaultRoot>/.te/agents/<sessionId>.json */
  private readSidecar(sessionId: string): AgentSidecar | null {
    try {
      const raw = readFileSync(join(this.vaultRoot, '.te', 'agents', `${sessionId}.json`), 'utf-8')
      return JSON.parse(raw) as AgentSidecar
    } catch {
      return null
    }
  }
}
