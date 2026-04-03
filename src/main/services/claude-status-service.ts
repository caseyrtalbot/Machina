import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeStatus } from '@shared/claude-status-types'
import { CLAUDE_STATUS_INITIAL } from '@shared/claude-status-types'

const exec = promisify(execFile)
const CHECK_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000

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

export class ClaudeStatusService {
  private status: ClaudeStatus = { ...CLAUDE_STATUS_INITIAL }
  private timer: ReturnType<typeof setInterval> | null = null
  private onChange: ((status: ClaudeStatus) => void) | null = null

  setOnChange(cb: (status: ClaudeStatus) => void): void {
    this.onChange = cb
  }

  getStatus(): ClaudeStatus {
    return this.status
  }

  async check(): Promise<ClaudeStatus> {
    const previous = this.status
    let installed = false
    let version: string | null = null
    let authenticated = false
    let email: string | null = null
    let subscriptionType: string | null = null
    let error: string | null = null

    // Probe 1: check if claude CLI is available and get version
    try {
      const { stdout } = await exec('claude', ['--version'], { timeout: PROBE_TIMEOUT_MS })
      const match = stdout.trim().match(/^(\d+\.\d+\.\d+)/)
      if (match) {
        installed = true
        version = match[1]
      } else {
        // Got output but couldn't parse version — still installed
        installed = true
      }
    } catch {
      // claude not in PATH or errored
      installed = false
      error = 'Claude Code CLI not found in PATH'
    }

    // Probe 2: check auth (only if installed)
    if (installed) {
      try {
        const { stdout } = await exec('claude', ['auth', 'status'], {
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
      installed,
      authenticated,
      version,
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
