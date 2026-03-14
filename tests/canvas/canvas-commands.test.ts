import { describe, it, expect, beforeEach } from 'vitest'
import { CommandStack, type Command } from
  '../../src/renderer/src/panels/canvas/canvas-commands'

describe('CommandStack', () => {
  let stack: CommandStack

  beforeEach(() => {
    stack = new CommandStack()
  })

  it('starts empty, cannot undo or redo', () => {
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
  })

  it('executes and undoes a command', () => {
    let value = 0
    const cmd: Command = {
      execute: () => { value = 1 },
      undo: () => { value = 0 }
    }

    stack.execute(cmd)
    expect(value).toBe(1)
    expect(stack.canUndo()).toBe(true)

    stack.undo()
    expect(value).toBe(0)
    expect(stack.canUndo()).toBe(false)
  })

  it('redoes after undo', () => {
    let value = 0
    const cmd: Command = {
      execute: () => { value = 1 },
      undo: () => { value = 0 }
    }

    stack.execute(cmd)
    stack.undo()
    expect(stack.canRedo()).toBe(true)

    stack.redo()
    expect(value).toBe(1)
  })

  it('clears redo stack on new execute', () => {
    let value = 0
    const cmd1: Command = {
      execute: () => { value = 1 },
      undo: () => { value = 0 }
    }
    const cmd2: Command = {
      execute: () => { value = 2 },
      undo: () => { value = 1 }
    }

    stack.execute(cmd1)
    stack.undo()
    stack.execute(cmd2)
    expect(stack.canRedo()).toBe(false)
    expect(value).toBe(2)
  })

  it('caps at max size', () => {
    const stack = new CommandStack(3)
    for (let i = 0; i < 5; i++) {
      stack.execute({ execute: () => {}, undo: () => {} })
    }
    // Only 3 undos available
    let undos = 0
    while (stack.canUndo()) { stack.undo(); undos++ }
    expect(undos).toBe(3)
  })
})
