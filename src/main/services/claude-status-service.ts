import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeStatus } from '@shared/claude-status-types'
import { CLAUDE_STATUS_INITIAL } from '@shared/claude-status-types'
import { getAgentSpec } from '@shared/cli-agents'
import { detectInstalledAgents, type ExecFn } from './cli-agent-detector'

const CHECK_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000

const defaultExec: ExecFn = (() => {
  const wrapped = promisify(execFile)
  return async (cmd, args, opts) => {
    const { stdout, stderr } = await wrapped(cmd, [...args], { ...opts, encoding: 'utf8' })
    return { stdout, stderr }
  }
})()

function statusEquals(a: ClaudeStatus, b: ClaudeStatus): boolean {
  return (
    a.installed === b.installed &&
    a.authenticated === b.authenticated &&
    a.version === b.version &&
    a.email === b.email &&
    a.subscriptionType === b.subscriptionType &&
    a.error === b.error
  )
}

export interface ClaudeStatusServiceOptions {
  readonly exec?: ExecFn
}

export class ClaudeStatusService {
  private status: ClaudeStatus = { ...CLAUDE_STATUS_INITIAL }
  private timer: ReturnType<typeof setInterval> | null = null
  private onChange: ((status: ClaudeStatus) => void) | null = null
  private readonly exec: ExecFn

  constructor(options: ClaudeStatusServiceOptions = {}) {
    this.exec = options.exec ?? defaultExec
  }

  setOnChange(cb: (status: ClaudeStatus) => void): void {
    this.onChange = cb
  }

  getStatus(): ClaudeStatus {
    return this.status
  }

  async check(): Promise<ClaudeStatus> {
    const previous = this.status

    // Probe 1: installation + version, delegated to the CLI agent registry.
    const claudeSpec = getAgentSpec('claude')
    if (!claudeSpec) {
      // Defensive: registry should always know about claude. Surface as error.
      const next: ClaudeStatus = {
        ...CLAUDE_STATUS_INITIAL,
        lastChecked: Date.now(),
        error: 'Claude agent missing from CLI registry'
      }
      this.status = next
      if (!statusEquals(previous, next) && this.onChange) this.onChange(next)
      return next
    }

    const [installation] = await detectInstalledAgents({
      exec: this.exec,
      agents: [claudeSpec]
    })

    let authenticated = false
    let email: string | null = null
    let subscriptionType: string | null = null
    let error: string | null = installation.error

    // Probe 2: auth (only if the CLI is installed).
    if (installation.installed) {
      try {
        const { stdout } = await this.exec('claude', ['auth', 'status'], {
          timeout: PROBE_TIMEOUT_MS
        })
        const parsed = JSON.parse(stdout.trim()) as {
          loggedIn?: boolean
          email?: string
          subscriptionType?: string
        }
        authenticated = parsed.loggedIn === true
        email = parsed.email ?? null
        subscriptionType = parsed.subscriptionType ?? null
        if (!authenticated) {
          error = 'Claude Code CLI is not signed in'
        }
      } catch (err) {
        authenticated = false
        error = err instanceof Error ? `Auth check failed: ${err.message}` : 'Auth check failed'
      }
    }

    const next: ClaudeStatus = {
      installed: installation.installed,
      authenticated,
      version: installation.version,
      email,
      subscriptionType,
      lastChecked: Date.now(),
      error
    }

    this.status = next

    if (!statusEquals(previous, next) && this.onChange) {
      this.onChange(next)
    }

    return next
  }

  start(): void {
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
