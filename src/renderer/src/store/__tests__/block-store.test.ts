import { describe, it, expect, beforeEach } from 'vitest'
import { useBlockStore } from '../block-store'
import { pendingBlock, startBlock, completeBlock, cancelBlock } from '@shared/engine/block-model'
import type { Block, BlockMetadata } from '@shared/engine/block-model'

const meta = (sessionId: string): BlockMetadata => ({
  sessionId,
  cwd: '/tmp',
  user: 'casey',
  host: 'spark',
  shellType: 'zsh'
})

const running = (id: string, sessionId: string, command: string): Block => {
  const p = pendingBlock(id, meta(sessionId))
  const r = startBlock(p, command, 1000)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const completed = (id: string, sessionId: string, command: string, exitCode: number): Block => {
  const r = running(id, sessionId, command)
  const c = completeBlock(r, exitCode, 2000)
  if (!c.ok) throw new Error(c.error)
  return c.value
}

const cancelled = (id: string, sessionId: string, command: string): Block => {
  const r = running(id, sessionId, command)
  const c = cancelBlock(r, 2000)
  if (!c.ok) throw new Error(c.error)
  return c.value
}

describe('block-store', () => {
  beforeEach(() => {
    useBlockStore.setState(useBlockStore.getInitialState())
  })

  it('starts empty', () => {
    expect(useBlockStore.getState().blocksBySession).toEqual({})
  })

  it('appends a new block to a session', () => {
    const block = running('b1', 's1', 'ls')
    useBlockStore.getState().applyUpdate('s1', block)
    const list = useBlockStore.getState().getBlocks('s1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('b1')
  })

  it('replaces an existing block by id (running → completed)', () => {
    const r = running('b1', 's1', 'ls')
    const c = completed('b1', 's1', 'ls', 0)
    const store = useBlockStore.getState()
    store.applyUpdate('s1', r)
    store.applyUpdate('s1', c)
    const list = useBlockStore.getState().getBlocks('s1')
    expect(list).toHaveLength(1)
    expect(list[0].state.kind).toBe('completed')
  })

  it('preserves insertion order across transitions', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', running('b1', 's1', 'first'))
    store.applyUpdate('s1', running('b2', 's1', 'second'))
    store.applyUpdate('s1', completed('b1', 's1', 'first', 0))
    const list = useBlockStore.getState().getBlocks('s1')
    expect(list.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(list[0].state.kind).toBe('completed')
    expect(list[1].state.kind).toBe('running')
  })

  it('isolates sessions', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', running('b1', 's1', 'a'))
    store.applyUpdate('s2', running('b1', 's2', 'b'))
    expect(useBlockStore.getState().getBlocks('s1')).toHaveLength(1)
    expect(useBlockStore.getState().getBlocks('s2')).toHaveLength(1)
    expect(useBlockStore.getState().getBlocks('s1')[0].command).toBe('a')
    expect(useBlockStore.getState().getBlocks('s2')[0].command).toBe('b')
  })

  it('getBlock returns the block by id, or undefined', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', completed('b1', 's1', 'ls', 0))
    expect(useBlockStore.getState().getBlock('s1', 'b1')?.command).toBe('ls')
    expect(useBlockStore.getState().getBlock('s1', 'missing')).toBeUndefined()
    expect(useBlockStore.getState().getBlock('missing', 'b1')).toBeUndefined()
  })

  it('records cancelled state', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', running('b1', 's1', 'sleep 100'))
    store.applyUpdate('s1', cancelled('b1', 's1', 'sleep 100'))
    expect(useBlockStore.getState().getBlock('s1', 'b1')?.state.kind).toBe('cancelled')
  })

  it('returns empty list for unknown session', () => {
    expect(useBlockStore.getState().getBlocks('nope')).toEqual([])
  })

  it('clearSession removes all blocks for that session only', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', running('b1', 's1', 'a'))
    store.applyUpdate('s2', running('b1', 's2', 'b'))
    store.clearSession('s1')
    expect(useBlockStore.getState().getBlocks('s1')).toEqual([])
    expect(useBlockStore.getState().getBlocks('s2')).toHaveLength(1)
  })

  it('returns a stable reference for the same session when unrelated sessions update', () => {
    const store = useBlockStore.getState()
    store.applyUpdate('s1', running('b1', 's1', 'a'))
    const before = useBlockStore.getState().getBlocks('s1')
    store.applyUpdate('s2', running('b1', 's2', 'b'))
    const after = useBlockStore.getState().getBlocks('s1')
    expect(after).toBe(before)
  })
})
