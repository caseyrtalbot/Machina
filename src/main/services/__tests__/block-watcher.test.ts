// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { BlockWatcher, type BlockUpdate } from '../block-watcher'

const ESC = '\x1b'
const BEL = '\x07'

const promptStart = `${ESC}]1337;te-prompt-start${BEL}`
const commandStart = (cwd: string, ts: number): string =>
  `${ESC}]1337;te-command-start;cwd=${cwd};ts=${ts};shell=zsh${BEL}`
const commandEnd = (exit: number, ts: number): string =>
  `${ESC}]1337;te-command-end;exit=${exit};ts=${ts}${BEL}`

function recordingWatcher(): { watcher: BlockWatcher; updates: BlockUpdate[] } {
  const updates: BlockUpdate[] = []
  let id = 0
  const watcher = new BlockWatcher({
    onUpdate: (u) => updates.push(u),
    nextBlockId: () => `b${++id}`
  })
  return { watcher, updates }
}

describe('BlockWatcher', () => {
  it('creates a pending block on prompt-start', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', promptStart)
    expect(updates).toHaveLength(1)
    expect(updates[0].sessionId).toBe('s1')
    expect(updates[0].block.state.kind).toBe('pending')
    expect(updates[0].block.id).toBe('b1')
  })

  it('promotes pending → running on command-start', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 100)}`)
    const last = updates[updates.length - 1].block
    expect(last.state.kind).toBe('running')
    if (last.state.kind !== 'running') return
    expect(last.state.startedAt).toBe(100)
    expect(last.metadata.cwd).toBe('/tmp')
    expect(last.metadata.shellType).toBe('zsh')
  })

  it('appends output-chunk text to the running block', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}line1\nline2\n`)
    const last = updates[updates.length - 1].block
    expect(last.outputText).toBe('line1\nline2\n')
  })

  it('completes the block on command-end', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}out${commandEnd(0, 5)}`)
    const last = updates[updates.length - 1].block
    expect(last.state).toEqual({
      kind: 'completed',
      startedAt: 1,
      finishedAt: 5,
      exitCode: 0
    })
    expect(last.outputText).toBe('out')
  })

  it('starts a fresh pending block on the next prompt-start', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe(
      's1',
      [promptStart, commandStart('/tmp', 1), 'a', commandEnd(0, 2), promptStart].join('')
    )
    const blocks = new Set(updates.map((u) => u.block.id))
    expect(blocks.size).toBe(2)
  })

  it('isolates state per session', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', promptStart)
    watcher.observe('s2', promptStart)
    const ids = updates.map((u) => `${u.sessionId}:${u.block.id}`)
    expect(ids).toEqual(['s1:b1', 's2:b2'])
  })

  it('discards session state on closeSession', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}`)
    watcher.closeSession('s1')
    // After close, a fresh prompt-start under the same session id starts a NEW block.
    watcher.observe('s1', promptStart)
    const lastTwo = updates.slice(-1)
    expect(lastTwo[0].block.state.kind).toBe('pending')
    expect(lastTwo[0].block.outputText).toBe('')
  })
})
