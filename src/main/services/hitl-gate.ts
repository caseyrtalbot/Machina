/**
 * HITL (Human-in-the-Loop) gate for destructive MCP operations.
 *
 * Blocks agent write operations until the user confirms. The gate is
 * injectable: tests can substitute a mock that auto-approves or
 * auto-denies. The production gate is QueueHitlGate (queue-hitl-gate.ts)
 * over the approval queue.
 */
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
