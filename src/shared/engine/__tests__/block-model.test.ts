import { describe, it, expect } from 'vitest'
import { pendingBlock, type BlockMetadata } from '../block-model'

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
