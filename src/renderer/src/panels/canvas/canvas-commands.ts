export interface Command {
  execute: () => void
  undo: () => void
}

export class CommandStack {
  private stack: Command[] = []
  private index = -1
  private maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  execute(cmd: Command): void {
    cmd.execute()
    // Discard any redo history
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(cmd)
    this.index++

    // Cap size
    if (this.stack.length > this.maxSize) {
      const excess = this.stack.length - this.maxSize
      this.stack = this.stack.slice(excess)
      this.index -= excess
    }
  }

  undo(): void {
    if (!this.canUndo()) return
    this.stack[this.index].undo()
    this.index--
  }

  redo(): void {
    if (!this.canRedo()) return
    this.index++
    this.stack[this.index].execute()
  }

  canUndo(): boolean {
    return this.index >= 0
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  clear(): void {
    this.stack = []
    this.index = -1
  }
}
