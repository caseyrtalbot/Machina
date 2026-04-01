/**
 * HITL (Human-in-the-Loop) gate for destructive MCP operations.
 *
 * Blocks agent write operations until the user confirms via Electron
 * dialog. The gate is injectable: tests can substitute a mock that
 * auto-approves or auto-denies without requiring an Electron window.
 */
import { dialog } from 'electron'

export interface HitlDecision {
  readonly allowed: boolean
  readonly reason: string
}

export interface HitlConfirmOpts {
  readonly tool: string
  readonly path: string
  readonly description: string
  readonly contentPreview?: string
}

export interface HitlGate {
  /** Request confirmation for an operation. Returns decision. */
  confirm(opts: HitlConfirmOpts): Promise<HitlDecision>
}

/**
 * In-memory write velocity tracker.
 *
 * Tracks timestamps of recent writes within a sliding 60-second window.
 * When the threshold is exceeded, the HITL gate description changes to
 * flag high-velocity writes for extra user scrutiny. Does NOT auto-deny;
 * the user always has final say.
 */
export class WriteRateLimiter {
  private timestamps: number[] = []

  isExceeded(maxPerMinute: number = 10): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000)
    return this.timestamps.length >= maxPerMinute
  }

  record(): void {
    this.timestamps.push(Date.now())
  }

  /** Record a write at a specific timestamp (for testing). */
  recordAt(ts: number): void {
    this.timestamps.push(ts)
  }
}

/**
 * Wraps any HitlGate with a timeout.
 * If the inner gate does not respond within timeoutMs, auto-denies.
 * Prevents agent operations from blocking indefinitely when the
 * app is backgrounded or the user is away.
 */
export class TimeoutHitlGate implements HitlGate {
  constructor(
    private readonly inner: HitlGate,
    private readonly timeoutMs: number = 30_000
  ) {}

  async confirm(opts: HitlConfirmOpts): Promise<HitlDecision> {
    return Promise.race([
      this.inner.confirm(opts),
      new Promise<HitlDecision>((resolve) =>
        setTimeout(
          () =>
            resolve({
              allowed: false,
              reason: `Denied: HITL gate timeout (${this.timeoutMs}ms)`
            }),
          this.timeoutMs
        )
      )
    ])
  }
}

/**
 * Production HITL gate using Electron's native dialog.
 *
 * Shows a confirmation dialog to the user before allowing destructive
 * MCP operations (file writes and creates).
 */
export class ElectronHitlGate implements HitlGate {
  async confirm(opts: HitlConfirmOpts): Promise<HitlDecision> {
    const preview = opts.contentPreview ? `\n\nPreview:\n${opts.contentPreview}` : ''

    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Allow', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      title: 'Agent Write Request',
      message: `${opts.tool}: ${opts.description}`,
      detail: `Path: ${opts.path}${preview}`
    })

    return response === 0
      ? { allowed: true, reason: 'User approved via dialog' }
      : { allowed: false, reason: 'User denied via dialog' }
  }
}
