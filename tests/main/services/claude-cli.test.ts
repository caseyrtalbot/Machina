// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable, Writable } from 'stream'
import { extractJsonFromResponse, callClaudeWith } from '../../../src/main/services/claude-cli'
import type { ClaudeCliStreamEvent } from '../../../src/main/services/claude-cli'

describe('extractJsonFromResponse', () => {
  it('extracts JSON from a code fence', () => {
    const text = 'Here is the plan:\n```json\n{"ops": []}\n```\nDone.'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [] })
  })

  it('extracts JSON from bare code fence', () => {
    const text = '```\n{"ops": [{"type": "move-node"}]}\n```'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [{ type: 'move-node' }] })
  })

  it('extracts raw JSON object when no fence', () => {
    const text = '{"ops": [{"type": "add-node"}]}'
    expect(extractJsonFromResponse(text)).toEqual({ ops: [{ type: 'add-node' }] })
  })

  it('throws when no JSON found', () => {
    expect(() => extractJsonFromResponse('No json here')).toThrow('No JSON found')
  })
})

// ---------------------------------------------------------------------------
// callClaude streaming tests — use a fake ChildProcess-like shape
// ---------------------------------------------------------------------------

function makeFakeProc() {
  const noop = () => {}
  const stdout = new Readable({ read: noop })
  const stderr = new Readable({ read: noop })
  const stdin = new Writable({
    write(_c, _e, cb) {
      cb()
    }
  })
  const ee = new EventEmitter()
  const proc = {
    stdout,
    stderr,
    stdin,
    kill: vi.fn((_sig?: string) => {
      ee.emit('close', 0)
    }),
    on: (event: string, cb: (...args: unknown[]) => void) => ee.on(event, cb),
    emit: (event: string, ...args: unknown[]) => ee.emit(event, ...args)
  }
  return proc
}

function emitLine(proc: ReturnType<typeof makeFakeProc>, obj: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}

describe('callClaudeWith streaming transport', () => {
  it('parses stream events and forwards typed deltas via onEvent', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const spawned: Array<{ bin: string; args: string[] }> = []
    const spawnFn = (bin: string, args: string[]) => {
      spawned.push({ bin, args })
      return proc as unknown as ReturnType<typeof import('child_process').spawn>
    }

    const events: ClaudeCliStreamEvent[] = []
    const pending = callClaudeWith(spawnFn, 'prompt text', (ev) => events.push(ev))

    await Promise.resolve()

    emitLine(proc, { type: 'system', subtype: 'init' })
    emitLine(proc, { type: 'stream_event', event: { type: 'message_start' } })
    emitLine(proc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm...' } }
    })
    emitLine(proc, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Here is the plan.' }
      }
    })
    emitLine(proc, { type: 'result', result: '```json\n{"ops":[]}\n```' })
    proc.emit('close', 0)

    const output = await pending
    expect(output).toContain('"ops"')
    expect(spawned[0].args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages'
    ])
    expect(events.map((e) => e.kind)).toEqual(['phase', 'thinking-delta', 'phase', 'text-delta'])
    const phases = events.filter((e) => e.kind === 'phase') as Extract<
      ClaudeCliStreamEvent,
      { kind: 'phase' }
    >[]
    expect(phases.map((p) => p.phase)).toEqual(['thinking', 'drafting'])
    vi.useRealTimers()
  })

  it('throws stalled error with tag after 30s silence', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    vi.advanceTimersByTime(30_001)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { tag?: string }).tag).toBe('stalled')
    vi.useRealTimers()
  })

  it('throws cap error with tag after 180s even with activity', async () => {
    vi.useFakeTimers()
    const proc = makeFakeProc()
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    for (let t = 0; t < 180_000; t += 10_000) {
      emitLine(proc, { type: 'system' })
      vi.advanceTimersByTime(10_000)
    }
    vi.advanceTimersByTime(1)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { tag?: string }).tag).toBe('cap')
    vi.useRealTimers()
  })

  it('throws cli-error tag on non-zero exit', async () => {
    const proc = makeFakeProc()
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    proc.stderr.emit('data', Buffer.from('some error text\n'))
    proc.emit('close', 1)
    const err = await pending
    expect((err as Error & { tag?: string }).tag).toBe('cli-error')
    expect((err as Error).message).toContain('some error text')
  })

  it('throws not-found tag when spawn fires ENOENT error', async () => {
    const proc = makeFakeProc()
    const pending = callClaudeWith(
      () => proc as unknown as ReturnType<typeof import('child_process').spawn>,
      'prompt',
      () => {}
    ).catch((e) => e)

    await Promise.resolve()
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    proc.emit('error', enoent)
    const err = await pending
    expect((err as Error & { tag?: string }).tag).toBe('not-found')
  })
})
