/**
 * Typed PTY write arbitration.
 *
 * Per-session FIFO queue with single-flight drain. Replaces the previous
 * fire-and-forget pty.write() calls so user, agent, and raw-byte writes can
 * be distinguished, observed, and (later) policy-gated.
 *
 * Borrowed concept from Warp's terminal/writeable_pty/pty_controller.rs.
 */

export type PtyWrite =
  | { readonly kind: 'command'; readonly text: string }
  | { readonly kind: 'bytes'; readonly data: string }
  | {
      readonly kind: 'agent-input'
      readonly mode: 'streaming' | 'batched'
      readonly data: string
    }

export type PtyWriteFlusher = (write: PtyWrite) => void | Promise<void>

export class PtyWriteQueue {
  private readonly queue: PtyWrite[] = []
  private draining = false

  enqueue(write: PtyWrite): void {
    this.queue.push(write)
  }

  size(): number {
    return this.queue.length
  }

  /**
   * Drain the queue through `flusher`. If another drain is already running,
   * await its completion (single-flight) — this keeps writes serialized even
   * when multiple async callers race to flush.
   */
  async drain(flusher: PtyWriteFlusher): Promise<void> {
    if (this.draining) {
      while (this.draining) {
        await new Promise((r) => setTimeout(r, 1))
      }
      return
    }
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift() as PtyWrite
        await flusher(next)
      }
    } finally {
      this.draining = false
    }
  }
}
