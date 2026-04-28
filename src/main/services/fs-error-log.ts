interface FsError {
  readonly path: string
  readonly error: string
  readonly at: number
}

export class FsErrorLog {
  private readonly buffer: FsError[] = []
  private readonly capacity: number
  private readonly isPending: (path: string) => boolean

  constructor(capacity: number, isPending: (path: string) => boolean) {
    this.capacity = capacity
    this.isPending = isPending
  }

  push(path: string, error: string): void {
    if (this.isPending(path)) return
    if (this.buffer.length >= this.capacity) this.buffer.shift()
    this.buffer.push({ path, error, at: Date.now() })
  }

  drain(): readonly FsError[] {
    const snapshot = [...this.buffer]
    this.buffer.length = 0
    return snapshot
  }
}
