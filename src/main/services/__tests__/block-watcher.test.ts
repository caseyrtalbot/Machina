// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BlockWatcher, type BlockUpdate } from '../block-watcher'

const ESC = '\x1b'
const BEL = '\x07'

const promptStart = `${ESC}]1337;te-prompt-start${BEL}`
const commandStart = (cwd: string, ts: number, extra = ''): string =>
  `${ESC}]1337;te-command-start;cwd=${cwd};ts=${ts};shell=zsh${extra}${BEL}`
const commandEnd = (exit: number, ts: number): string =>
  `${ESC}]1337;te-command-end;exit=${exit};ts=${ts}${BEL}`

function recordingWatcher(throttleMs = 0): { watcher: BlockWatcher; updates: BlockUpdate[] } {
  const updates: BlockUpdate[] = []
  let id = 0
  const watcher = new BlockWatcher({
    onUpdate: (u) => updates.push(u),
    nextBlockId: () => `b${++id}`,
    throttleMs
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

  it('populates command from the percent-encoded cmd= key', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1, ';cmd=ls%3B echo 100%25')}`)
    const last = updates[updates.length - 1].block
    expect(last.command).toBe('ls; echo 100%')
  })

  it('derives command from the output echo at command-end when cmd= is absent', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe(
      's1',
      `${promptStart}${commandStart('/tmp', 1)}ls\r\nfile1.txt\r\n${commandEnd(0, 5)}`
    )
    const last = updates[updates.length - 1].block
    expect(last.state.kind).toBe('completed')
    expect(last.command).toBe('ls')
  })

  it('keeps the hook-provided command over the output-derived fallback', () => {
    const { watcher, updates } = recordingWatcher()
    watcher.observe(
      's1',
      `${promptStart}${commandStart('/tmp', 1, ';cmd=git status')}git status\r\nclean\r\n${commandEnd(0, 5)}`
    )
    const last = updates[updates.length - 1].block
    expect(last.command).toBe('git status')
  })
})

describe('BlockWatcher emit throttling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid output chunks to one immediate + one trailing emit', () => {
    vi.useFakeTimers()
    const { watcher, updates } = recordingWatcher(100)
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}`)
    const baseline = updates.length // pending + running, both urgent

    for (let i = 0; i < 20; i++) {
      watcher.observe('s1', `chunk${i}\n`)
    }
    // First chunk inside the window is deferred (lastEmitAt was just set by
    // the urgent command-start emit); nothing more until the trailing timer.
    expect(updates.length).toBe(baseline)

    vi.advanceTimersByTime(100)
    expect(updates.length).toBe(baseline + 1)
    // Trailing emit carries the LATEST snapshot (all 20 chunks).
    const last = updates[updates.length - 1].block
    expect(last.outputText).toContain('chunk19')
  })

  it('emits state transitions immediately, superseding pending chunk emits', () => {
    vi.useFakeTimers()
    const { watcher, updates } = recordingWatcher(100)
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}partial output`)
    const baseline = updates.length
    watcher.observe('s1', commandEnd(0, 5))
    // command-end is urgent: emitted without waiting for the trailing timer.
    expect(updates.length).toBe(baseline + 1)
    const last = updates[updates.length - 1].block
    expect(last.state.kind).toBe('completed')
    expect(last.outputText).toBe('partial output')
    // The superseded chunk emit must not fire afterwards.
    vi.advanceTimersByTime(500)
    expect(updates.length).toBe(baseline + 1)
  })

  it('closeSession cancels a pending trailing emit', () => {
    vi.useFakeTimers()
    const { watcher, updates } = recordingWatcher(100)
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}buffered`)
    const baseline = updates.length
    watcher.closeSession('s1')
    vi.advanceTimersByTime(500)
    expect(updates.length).toBe(baseline)
  })

  it('throttleMs 0 emits every chunk synchronously', () => {
    const { watcher, updates } = recordingWatcher(0)
    watcher.observe('s1', `${promptStart}${commandStart('/tmp', 1)}a`)
    watcher.observe('s1', 'b')
    const texts = updates.map((u) => u.block.outputText)
    expect(texts).toEqual(['', '', 'a', 'ab'])
  })
})
