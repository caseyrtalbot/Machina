import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBlockRecorder, parseRecording, replay, type RecordedEvent } from '../block-recorder'
import { createBlockDetector } from '../block-detector'
import type { Block } from '../block-model'

const FIXTURES_DIR = join(__dirname, '__fixtures__', 'recorded-sessions')

const ESC = '\x1b'
const BEL = '\x07'

const fakeIdFactory = (): (() => string) => {
  let n = 0
  return () => `te-block-${++n}`
}

interface BlockSummary {
  readonly id: string
  readonly command: string
  readonly state: Block['state']
  readonly outputText: string
  readonly cwd: string | null
  readonly shellType: string
  readonly secrets: readonly { kind: string; start: number; end: number }[]
}

const summarize = (b: Block): BlockSummary => ({
  id: b.id,
  command: b.command,
  state: b.state,
  outputText: b.outputText,
  cwd: b.metadata.cwd,
  shellType: b.metadata.shellType,
  secrets: b.secrets.map((s) => ({ kind: s.kind, start: s.start, end: s.end }))
})

describe('createBlockRecorder', () => {
  it('serialize → parse roundtrip preserves events', () => {
    const recorder = createBlockRecorder()
    const events: readonly RecordedEvent[] = [
      { kind: 'pty-bytes', data: 'hello' },
      { kind: 'prompt-start' },
      {
        kind: 'command-start',
        cwd: '/tmp',
        ts: 100,
        meta: { shell: 'zsh', user: 'casey' }
      },
      { kind: 'output-chunk', text: 'world' },
      { kind: 'command-end', exit: 0, ts: 200 }
    ]
    for (const e of events) recorder.recordEvent(e)
    const serialized = recorder.serialize()
    const lines = serialized.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(events.length)
    expect(parseRecording(serialized)).toEqual(events)
  })

  it('serialization is deterministic across recorder instances', () => {
    const events: readonly RecordedEvent[] = [
      { kind: 'pty-bytes', data: 'a' },
      { kind: 'pty-bytes', data: 'b' }
    ]
    const a = createBlockRecorder()
    const b = createBlockRecorder()
    for (const e of events) {
      a.recordEvent(e)
      b.recordEvent(e)
    }
    expect(a.serialize()).toBe(b.serialize())
  })

  it('parseRecording skips blank lines and ignores trailing whitespace', () => {
    const serialized = '\n{"kind":"pty-bytes","data":"x"}\n\n{"kind":"prompt-start"}\n  \n'
    expect(parseRecording(serialized)).toEqual([
      { kind: 'pty-bytes', data: 'x' },
      { kind: 'prompt-start' }
    ])
  })
})

describe('replay', () => {
  it('produces a single completed block for a clean ls fixture', () => {
    const serialized = readFileSync(join(FIXTURES_DIR, 'clean-ls.jsonl'), 'utf-8')
    const blocks = replay(serialized, createBlockDetector(), { idFactory: fakeIdFactory() })
    expect(blocks.map(summarize)).toEqual([
      {
        id: 'te-block-1',
        command: '',
        state: { kind: 'completed', startedAt: 1000, finishedAt: 1100, exitCode: 0 },
        outputText: 'ls\r\nfile1.txt  file2.txt\r\n',
        cwd: '/tmp',
        shellType: 'zsh',
        secrets: []
      }
    ])
  })

  it('captures non-zero exit for a stderr fixture', () => {
    const serialized = readFileSync(join(FIXTURES_DIR, 'stderr.jsonl'), 'utf-8')
    const blocks = replay(serialized, createBlockDetector(), { idFactory: fakeIdFactory() })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].state).toEqual({
      kind: 'completed',
      startedAt: 2000,
      finishedAt: 2050,
      exitCode: 1
    })
    expect(blocks[0].outputText).toContain('No such file or directory')
  })

  it('captures exit 130 for a cancelled (Ctrl+C) fixture', () => {
    const serialized = readFileSync(join(FIXTURES_DIR, 'cancelled-sigint.jsonl'), 'utf-8')
    const blocks = replay(serialized, createBlockDetector(), { idFactory: fakeIdFactory() })
    expect(blocks).toHaveLength(1)
    const state = blocks[0].state
    expect(state.kind).toBe('completed')
    if (state.kind !== 'completed') return
    expect(state.exitCode).toBe(130)
    expect(blocks[0].outputText).toContain('^C')
  })

  it('feeding the same recording twice yields identical block lists', () => {
    const serialized = readFileSync(join(FIXTURES_DIR, 'clean-ls.jsonl'), 'utf-8')
    const a = replay(serialized, createBlockDetector(), { idFactory: fakeIdFactory() })
    const b = replay(serialized, createBlockDetector(), { idFactory: fakeIdFactory() })
    expect(a.map(summarize)).toEqual(b.map(summarize))
  })

  it('handles a multi-block fixture (two commands in sequence)', () => {
    const recorder = createBlockRecorder()
    const cmd1 = `${ESC}]1337;te-prompt-start${BEL}${ESC}]1337;te-command-start;cwd=/tmp;ts=1;shell=zsh${BEL}one\n${ESC}]1337;te-command-end;exit=0;ts=2${BEL}`
    const cmd2 = `${ESC}]1337;te-prompt-start${BEL}${ESC}]1337;te-command-start;cwd=/tmp;ts=3;shell=zsh${BEL}two\n${ESC}]1337;te-command-end;exit=0;ts=4${BEL}`
    recorder.recordEvent({ kind: 'pty-bytes', data: cmd1 })
    recorder.recordEvent({ kind: 'pty-bytes', data: cmd2 })
    const blocks = replay(recorder.serialize(), createBlockDetector(), {
      idFactory: fakeIdFactory()
    })
    expect(blocks).toHaveLength(2)
    expect(blocks[0].outputText).toBe('one\n')
    expect(blocks[1].outputText).toBe('two\n')
    expect(blocks[0].id).toBe('te-block-1')
    expect(blocks[1].id).toBe('te-block-2')
  })
})
