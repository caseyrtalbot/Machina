import { describe, it, expect } from 'vitest'
import {
  pendingBlock,
  startBlock,
  completeBlock,
  cancelBlock,
  appendOutput,
  setAgentContext,
  type BlockMetadata
} from '../block-model'

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
    expect(b.outputBytes.byteLength).toBe(0)
    expect(b.agentContext).toBeNull()
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
  it('appends bytes and text immutably', () => {
    const b = pendingBlock('b1', meta())
    const out1 = appendOutput(b, new Uint8Array([0x68, 0x69]), 'hi')
    const out2 = appendOutput(out1, new Uint8Array([0x21]), '!')
    expect(out2.outputText).toBe('hi!')
    expect(Array.from(out2.outputBytes)).toEqual([0x68, 0x69, 0x21])
    expect(b.outputText).toBe('')
    expect(b.outputBytes.byteLength).toBe(0)
  })

  it('handles empty appends without copying', () => {
    const b = pendingBlock('b1', meta())
    const same = appendOutput(b, new Uint8Array(), '')
    expect(same.outputText).toBe('')
    expect(same.outputBytes.byteLength).toBe(0)
  })
})

describe('setAgentContext', () => {
  it('attaches agent context immutably', () => {
    const b = pendingBlock('b1', meta())
    const tagged = setAgentContext(b, {
      agentId: 'claude',
      sessionId: 's',
      toolName: 'Edit'
    })
    expect(tagged.agentContext).toEqual({
      agentId: 'claude',
      sessionId: 's',
      toolName: 'Edit'
    })
    expect(b.agentContext).toBeNull()
  })

  it('overwrites a previously set context', () => {
    const b = pendingBlock('b1', meta())
    const a = setAgentContext(b, { agentId: 'claude', sessionId: '1', toolName: null })
    const c = setAgentContext(a, { agentId: 'codex', sessionId: '2', toolName: 'Read' })
    expect(c.agentContext?.agentId).toBe('codex')
  })
})
