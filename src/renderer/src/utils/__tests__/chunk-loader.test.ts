import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  chunkArray,
  readChunk,
  yieldToEventLoop,
  DEFAULT_CHUNK_SIZE,
  useIndexingProgress,
  setIndexingProgress,
  clearIndexingProgress
} from '../chunk-loader'

describe('chunkArray', () => {
  it('splits 200 items into 4 chunks of 50', () => {
    const items = Array.from({ length: 200 }, (_, i) => i)
    const chunks = chunkArray(items, 50)
    expect(chunks).toHaveLength(4)
    expect(chunks.every((c) => c.length === 50)).toBe(true)
  })

  it('handles items not evenly divisible by chunk size', () => {
    const items = Array.from({ length: 130 }, (_, i) => i)
    const chunks = chunkArray(items, 50)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(50)
    expect(chunks[1]).toHaveLength(50)
    expect(chunks[2]).toHaveLength(30)
  })

  it('returns a single chunk when items fit within size', () => {
    const items = [1, 2, 3]
    const chunks = chunkArray(items, 50)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual([1, 2, 3])
  })

  it('returns one empty chunk for empty input', () => {
    const chunks = chunkArray([], 50)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual([])
  })

  it('uses DEFAULT_CHUNK_SIZE when no size is provided', () => {
    const items = Array.from({ length: DEFAULT_CHUNK_SIZE + 1 }, (_, i) => i)
    const chunks = chunkArray(items)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(DEFAULT_CHUNK_SIZE)
    expect(chunks[1]).toHaveLength(1)
  })

  it('throws when chunk size is less than 1', () => {
    expect(() => chunkArray([1, 2, 3], 0)).toThrow('Chunk size must be >= 1')
    expect(() => chunkArray([1, 2, 3], -1)).toThrow('Chunk size must be >= 1')
  })

  it('preserves item order across chunks', () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    const chunks = chunkArray(items, 3)
    const flattened = chunks.flat()
    expect(flattened).toEqual(items)
  })

  it('does not mutate the original array', () => {
    const items = [1, 2, 3, 4, 5]
    const copy = [...items]
    chunkArray(items, 2)
    expect(items).toEqual(copy)
  })
})

describe('readChunk', () => {
  it('reads all paths using the provided reader and limit', async () => {
    const reader = vi.fn(async (p: string) => `content-of-${p}`)
    const limit = <T>(fn: () => Promise<T>) => fn()

    const result = await readChunk(['a.md', 'b.md', 'c.md'], reader, limit)

    expect(result).toEqual([
      { path: 'a.md', content: 'content-of-a.md' },
      { path: 'b.md', content: 'content-of-b.md' },
      { path: 'c.md', content: 'content-of-c.md' }
    ])
    expect(reader).toHaveBeenCalledTimes(3)
  })

  it('returns empty array for empty paths', async () => {
    const reader = vi.fn(async (p: string) => p)
    const limit = <T>(fn: () => Promise<T>) => fn()

    const result = await readChunk([], reader, limit)
    expect(result).toEqual([])
    expect(reader).not.toHaveBeenCalled()
  })

  it('passes each call through the limit function', async () => {
    const callOrder: string[] = []
    const reader = vi.fn(async (p: string) => {
      callOrder.push(`read-${p}`)
      return p
    })
    const limitImpl = <T>(fn: () => Promise<T>): Promise<T> => {
      callOrder.push('limit')
      return fn()
    }
    const limit = vi.fn(limitImpl)

    await readChunk(['x.md', 'y.md'], reader, limit as typeof limitImpl)

    expect(limit).toHaveBeenCalledTimes(2)
    // limit should be called before each read
    expect(callOrder).toEqual(['limit', 'read-x.md', 'limit', 'read-y.md'])
  })

  it('propagates reader errors', async () => {
    const reader = vi.fn(async () => {
      throw new Error('disk fail')
    })
    const limit = <T>(fn: () => Promise<T>) => fn()

    await expect(readChunk(['fail.md'], reader, limit)).rejects.toThrow('disk fail')
  })
})

describe('yieldToEventLoop', () => {
  it('resolves after yielding', async () => {
    const start = performance.now()
    await yieldToEventLoop(0)
    const elapsed = performance.now() - start
    // Should resolve very quickly (within 50ms even on slow CI)
    expect(elapsed).toBeLessThan(50)
  })
})

describe('indexing progress store', () => {
  beforeEach(() => {
    clearIndexingProgress()
  })

  it('starts idle (total 0)', () => {
    expect(useIndexingProgress.getState()).toEqual({ indexed: 0, total: 0 })
  })

  it('setIndexingProgress publishes indexed/total', () => {
    setIndexingProgress(50, 5000)
    expect(useIndexingProgress.getState()).toEqual({ indexed: 50, total: 5000 })
  })

  it('clearIndexingProgress resets to idle', () => {
    setIndexingProgress(5000, 5000)
    clearIndexingProgress()
    expect(useIndexingProgress.getState()).toEqual({ indexed: 0, total: 0 })
  })
})

describe('progressive load integration', () => {
  it('first chunk resolves before remaining chunks are processed', async () => {
    const events: string[] = []
    const reader = vi.fn(async (p: string) => `content-${p}`)
    const limit = <T>(fn: () => Promise<T>) => fn()

    const paths = Array.from({ length: 120 }, (_, i) => `file-${i}.md`)
    const chunks = chunkArray(paths, 50)

    // Simulate the progressive load pattern from App.tsx
    const accumulated: Array<{ path: string; content: string }> = []

    // First chunk: synchronous
    const first = await readChunk(chunks[0], reader, limit)
    accumulated.push(...first)
    events.push(`loaded-chunk-0:${accumulated.length}`)

    // Remaining chunks: with yield
    for (let i = 1; i < chunks.length; i++) {
      await yieldToEventLoop(0)
      const batch = await readChunk(chunks[i], reader, limit)
      accumulated.push(...batch)
      events.push(`loaded-chunk-${i}:${accumulated.length}`)
    }

    expect(events).toEqual(['loaded-chunk-0:50', 'loaded-chunk-1:100', 'loaded-chunk-2:120'])
    expect(accumulated).toHaveLength(120)
  })

  it('handles vault with fewer files than chunk size', async () => {
    const reader = vi.fn(async (p: string) => `content-${p}`)
    const limit = <T>(fn: () => Promise<T>) => fn()
    const paths = ['one.md', 'two.md', 'three.md']
    const chunks = chunkArray(paths, 50)

    expect(chunks).toHaveLength(1)

    const first = await readChunk(chunks[0], reader, limit)
    expect(first).toHaveLength(3)
    // No remaining chunks to process
    expect(chunks.length).toBe(1)
  })
})
