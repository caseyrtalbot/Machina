import { describe, it, expect } from 'vitest'
import {
  pendingBlock,
  startBlock,
  completeBlock,
  cancelBlock,
  appendOutput,
  OUTPUT_HEAD_LIMIT,
  OUTPUT_TAIL_LIMIT,
  TRUNCATION_MARKER,
  type BlockMetadata
} from '../block-model'
import { SECRET_RESCAN_OVERLAP } from '../secrets'

const meta = (): BlockMetadata => ({
  sessionId: 's1',
  cwd: '/tmp',
  user: 'casey',
  host: 'spark',
  shellType: 'zsh'
})

describe('pendingBlock', () => {
  it('creates a block in pending state with empty output and no secrets', () => {
    const b = pendingBlock('b1', meta())
    expect(b.id).toBe('b1')
    expect(b.state).toEqual({ kind: 'pending' })
    expect(b.command).toBe('')
    expect(b.prompt).toBe('')
    expect(b.outputText).toBe('')
    expect(b.secrets).toEqual([])
    expect(b.metadata).toEqual(meta())
  })
})

describe('startBlock', () => {
  it('transitions pending → running with command + startedAt', () => {
    const b = pendingBlock('b1', meta())
    const r = startBlock(b, 'ls -la', 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.command).toBe('ls -la')
    expect(r.value.state).toEqual({ kind: 'running', startedAt: 1000 })
  })

  it('refuses to start a non-pending block', () => {
    const b = pendingBlock('b1', meta())
    const started = startBlock(b, 'ls', 1)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const again = startBlock(started.value, 'ls', 2)
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toMatch(/cannot start/i)
  })

  it('does not mutate the source block', () => {
    const b = pendingBlock('b1', meta())
    startBlock(b, 'ls', 1)
    expect(b.state).toEqual({ kind: 'pending' })
    expect(b.command).toBe('')
  })
})

describe('completeBlock', () => {
  it('transitions running → completed with exit code and timestamps', () => {
    const b = pendingBlock('b1', meta())
    const started = startBlock(b, 'true', 1000)
    if (!started.ok) throw new Error('precondition')
    const done = completeBlock(started.value, 0, 1500)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.value.state).toEqual({
      kind: 'completed',
      startedAt: 1000,
      finishedAt: 1500,
      exitCode: 0
    })
  })

  it('refuses to complete a pending block', () => {
    const b = pendingBlock('b1', meta())
    const r = completeBlock(b, 0, 1000)
    expect(r.ok).toBe(false)
  })

  it('refuses to complete a completed block', () => {
    const b = pendingBlock('b1', meta())
    const started = startBlock(b, 'true', 1)
    if (!started.ok) throw new Error('precondition')
    const done = completeBlock(started.value, 0, 2)
    if (!done.ok) throw new Error('precondition')
    const again = completeBlock(done.value, 0, 3)
    expect(again.ok).toBe(false)
  })
})

describe('cancelBlock', () => {
  it('transitions running → cancelled with timestamps', () => {
    const b = pendingBlock('b1', meta())
    const started = startBlock(b, 'sleep 99', 100)
    if (!started.ok) throw new Error('precondition')
    const c = cancelBlock(started.value, 200)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.value.state).toEqual({ kind: 'cancelled', startedAt: 100, finishedAt: 200 })
  })

  it('refuses to cancel a pending block', () => {
    const b = pendingBlock('b1', meta())
    const r = cancelBlock(b, 200)
    expect(r.ok).toBe(false)
  })
})

describe('appendOutput', () => {
  it('appends text immutably', () => {
    const b = pendingBlock('b1', meta())
    const out1 = appendOutput(b, 'hi')
    const out2 = appendOutput(out1, '!')
    expect(out2.outputText).toBe('hi!')
    expect(b.outputText).toBe('')
  })

  it('handles empty appends without copying', () => {
    const b = pendingBlock('b1', meta())
    const same = appendOutput(b, '')
    expect(same.outputText).toBe('')
    expect(same).toBe(b)
  })

  it('flags secrets present in the appended chunk', () => {
    const b = pendingBlock('b1', meta())
    const secret = 'sk-ant-' + 'A'.repeat(50)
    const text = `prefix ${secret} suffix`
    const out = appendOutput(b, text)
    expect(out.secrets).toHaveLength(1)
    expect(out.secrets[0]).toEqual({
      kind: 'anthropic',
      start: text.indexOf(secret),
      end: text.indexOf(secret) + secret.length
    })
  })

  it('flags a secret split across two chunks (rescans the overlap window)', () => {
    const b = pendingBlock('b1', meta())
    const secret = 'sk-ant-' + 'B'.repeat(50)
    const head = secret.slice(0, 20)
    const tail = secret.slice(20)
    const after1 = appendOutput(b, head)
    expect(after1.secrets).toEqual([])
    const after2 = appendOutput(after1, tail)
    expect(after2.outputText).toBe(secret)
    expect(after2.secrets).toHaveLength(1)
    expect(after2.secrets[0]).toEqual({
      kind: 'anthropic',
      start: 0,
      end: secret.length
    })
  })

  it('preserves earlier secrets that fall outside the overlap window', () => {
    const b = pendingBlock('b1', meta())
    const earlySecret = 'sk-ant-' + 'C'.repeat(50)
    const earlyChunk = `${earlySecret} `
    const filler = 'x'.repeat(2000)
    const lateSecret = 'AKIAIOSFODNN7EXAMPLE'
    const after1 = appendOutput(b, earlyChunk)
    expect(after1.secrets).toHaveLength(1)
    const after2 = appendOutput(after1, filler)
    const after3 = appendOutput(after2, lateSecret)
    expect(after3.secrets).toHaveLength(2)
    expect(after3.secrets[0].kind).toBe('anthropic')
    expect(after3.secrets[1].kind).toBe('aws-access')
  })

  it('retains a secret whose span straddles the rescan-window boundary', () => {
    const b = pendingBlock('b1', meta())
    // 57-char secret, terminated by a space so the greedy rule stops at its true end.
    const secret = 'sk-ant-' + 'D'.repeat(50)
    const chunk1 = `${secret} `
    // Size the filler so the final append's naive rescanStart (len - OVERLAP)
    // lands 10 chars into the secret span — i.e. start < rescanStart < end.
    const straddleOffset = 10
    const filler = 'x'.repeat(SECRET_RESCAN_OVERLAP + straddleOffset - chunk1.length)
    const after1 = appendOutput(b, chunk1)
    expect(after1.secrets).toHaveLength(1)
    const after2 = appendOutput(after1, filler)
    expect(after2.secrets).toHaveLength(1)
    // outputText.length is now OVERLAP + straddleOffset; the next append makes the
    // naive rescanStart = straddleOffset, which bisects the secret at [0, 57).
    const after3 = appendOutput(after2, '!')
    expect(after3.secrets).toEqual([{ kind: 'anthropic', start: 0, end: secret.length }])
  })
})

describe('appendOutput output cap', () => {
  const CAP = OUTPUT_HEAD_LIMIT + OUTPUT_TAIL_LIMIT + TRUNCATION_MARKER.length

  it('leaves output at or under the cap untouched', () => {
    const b = pendingBlock('b1', meta())
    const text = 'x'.repeat(CAP)
    const out = appendOutput(b, text)
    expect(out.outputText).toBe(text)
  })

  it('cuts the middle and inserts the truncation marker when over the cap', () => {
    const b = pendingBlock('b1', meta())
    const text = 'h'.repeat(OUTPUT_HEAD_LIMIT) + 'm'.repeat(1000) + 't'.repeat(OUTPUT_TAIL_LIMIT)
    const out = appendOutput(b, text)
    expect(out.outputText.length).toBe(CAP)
    expect(out.outputText.startsWith('h'.repeat(OUTPUT_HEAD_LIMIT))).toBe(true)
    expect(out.outputText.endsWith('t'.repeat(OUTPUT_TAIL_LIMIT))).toBe(true)
    expect(
      out.outputText.slice(OUTPUT_HEAD_LIMIT, OUTPUT_HEAD_LIMIT + TRUNCATION_MARKER.length)
    ).toBe(TRUNCATION_MARKER)
  })

  it('stays bounded across repeated appends and keeps exactly one marker', () => {
    let b = appendOutput(pendingBlock('b1', meta()), 'x'.repeat(CAP))
    for (let i = 0; i < 5; i++) {
      b = appendOutput(b, 'y'.repeat(10_000))
    }
    expect(b.outputText.length).toBe(CAP)
    expect(b.outputText.split(TRUNCATION_MARKER)).toHaveLength(2)
    expect(b.outputText.endsWith('y'.repeat(10_000))).toBe(true)
  })

  it('remaps tail secret offsets across the cut so masking stays aligned', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'
    const b = pendingBlock('b1', meta())
    // Last OUTPUT_TAIL_LIMIT chars (the kept tail) start with the secret.
    const text =
      'h'.repeat(OUTPUT_HEAD_LIMIT) +
      'm'.repeat(999) +
      ' ' +
      secret +
      ' ' +
      'z'.repeat(OUTPUT_TAIL_LIMIT - secret.length - 1)
    const out = appendOutput(b, text)
    expect(out.secrets).toHaveLength(1)
    const s = out.secrets[0]
    expect(out.outputText.slice(s.start, s.end)).toBe(secret)
  })

  it('keeps head secrets at their original offsets', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'
    const b = pendingBlock('b1', meta())
    const head = secret + ' ' + 'h'.repeat(OUTPUT_HEAD_LIMIT)
    const out = appendOutput(appendOutput(b, head), 't'.repeat(OUTPUT_TAIL_LIMIT + 1000))
    expect(out.outputText).toContain(TRUNCATION_MARKER)
    expect(out.secrets).toHaveLength(1)
    expect(out.outputText.slice(out.secrets[0].start, out.secrets[0].end)).toBe(secret)
    expect(out.secrets[0].start).toBe(0)
  })
})
