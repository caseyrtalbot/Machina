import { describe, it, expect } from 'vitest'
import { createBlockDetector } from '../block-detector'

const ESC = '\x1b'
const BEL = '\x07'

const promptStart = `${ESC}]1337;te-prompt-start${BEL}`
const commandStart = (cwd: string, ts: number, extra = ''): string =>
  `${ESC}]1337;te-command-start;cwd=${cwd};ts=${ts}${extra}${BEL}`
const commandEnd = (exit: number, ts: number): string =>
  `${ESC}]1337;te-command-end;exit=${exit};ts=${ts}${BEL}`

describe('BlockDetector', () => {
  it('emits prompt-start when it sees the marker', () => {
    const d = createBlockDetector()
    const events = d.consume(promptStart)
    expect(events).toEqual([{ kind: 'prompt-start' }])
  })

  it('emits command-start with cwd and ts parsed', () => {
    const d = createBlockDetector()
    const events = d.consume(commandStart('/tmp/x', 100))
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.kind).toBe('command-start')
    if (e.kind !== 'command-start') return
    expect(e.cwd).toBe('/tmp/x')
    expect(e.ts).toBe(100)
  })

  it('emits command-end with exit and ts parsed', () => {
    const d = createBlockDetector()
    const events = d.consume(commandEnd(0, 200))
    expect(events).toEqual([{ kind: 'command-end', exit: 0, ts: 200 }])
  })

  it('passes through non-marker bytes as output-chunk', () => {
    const d = createBlockDetector()
    const events = d.consume('hello world\n')
    expect(events).toEqual([{ kind: 'output-chunk', text: 'hello world\n' }])
  })

  it('separates output around markers', () => {
    const d = createBlockDetector()
    const events = d.consume(`pre${promptStart}post`)
    expect(events).toEqual([
      { kind: 'output-chunk', text: 'pre' },
      { kind: 'prompt-start' },
      { kind: 'output-chunk', text: 'post' }
    ])
  })

  it('buffers a marker split across two consume() calls', () => {
    const d = createBlockDetector()
    // Split mid-marker: first chunk ends inside the OSC payload.
    const split = promptStart.length - 5
    const a = promptStart.slice(0, split)
    const b = promptStart.slice(split)
    const ev1 = d.consume(a)
    expect(ev1).toEqual([])
    const ev2 = d.consume(b)
    expect(ev2).toEqual([{ kind: 'prompt-start' }])
  })

  it('passes through unrelated OSC 1337 sequences (e.g. iTerm own payloads)', () => {
    const d = createBlockDetector()
    const itermPayload = `${ESC}]1337;CurrentDir=/Users/x${BEL}`
    const events = d.consume(itermPayload)
    expect(events).toEqual([{ kind: 'output-chunk', text: itermPayload }])
  })

  it('drops malformed te-command-start (missing cwd) without stalling', () => {
    const d = createBlockDetector()
    const malformed = `${ESC}]1337;te-command-start;ts=1${BEL}good`
    const events = d.consume(malformed)
    // Malformed dropped, subsequent text passes through.
    expect(events).toEqual([{ kind: 'output-chunk', text: 'good' }])
  })

  it('parses extra metadata kv pairs on command-start', () => {
    const d = createBlockDetector()
    const events = d.consume(commandStart('/tmp', 10, ';shell=zsh;user=casey'))
    expect(events).toHaveLength(1)
    const e = events[0]
    if (e.kind !== 'command-start') throw new Error('precondition')
    expect(e.meta.shell).toBe('zsh')
    expect(e.meta.user).toBe('casey')
    expect(e.cwd).toBe('/tmp')
    expect(e.ts).toBe(10)
  })

  it('handles a full command lifecycle', () => {
    const d = createBlockDetector()
    const stream = [
      promptStart,
      commandStart('/home', 1),
      'output line 1\n',
      'output line 2\n',
      commandEnd(0, 2)
    ].join('')
    const events = d.consume(stream)
    const kinds = events.map((e) => e.kind)
    expect(kinds).toEqual(['prompt-start', 'command-start', 'output-chunk', 'command-end'])
  })
})
