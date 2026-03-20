export type FileEvent = 'add' | 'change' | 'unlink'

export interface BatchedEvent {
  readonly path: string
  readonly event: FileEvent
}

export type BatchFlushCallback = (events: BatchedEvent[]) => void

export class EventBatcher {
  private queue = new Map<string, FileEvent>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onFlush: BatchFlushCallback
  private readonly intervalMs: number

  constructor(onFlush: BatchFlushCallback, intervalMs: number) {
    this.onFlush = onFlush
    this.intervalMs = intervalMs
  }

  enqueue(path: string, event: FileEvent): void {
    this.queue.set(path, event)
    this.scheduleFlush()
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }

  private scheduleFlush(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.intervalMs)
  }

  private flush(): void {
    if (this.queue.size === 0) return
    const events: BatchedEvent[] = Array.from(this.queue.entries()).map(([path, event]) => ({
      path,
      event
    }))
    this.queue.clear()
    this.onFlush(events)
  }
}
