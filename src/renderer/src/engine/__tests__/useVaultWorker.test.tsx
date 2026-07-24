import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultWorker } from '../useVaultWorker'
import type { VaultIndexEntry } from '@shared/index-delta'

describe('useVaultWorker progressive hydration', () => {
  const workerMessages: unknown[] = []
  const terminate = vi.fn()

  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null

    postMessage(message: unknown): void {
      workerMessages.push(message)
    }

    terminate(): void {
      terminate()
    }
  }

  beforeEach(() => {
    workerMessages.length = 0
    terminate.mockClear()
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const entry = (path: string, id: string): VaultIndexEntry => ({
    path,
    artifact: {
      id,
      title: id,
      type: 'note',
      signal: 'untested',
      tags: [],
      connections: [],
      clusters_with: [],
      tensions_with: [],
      appears_in: [],
      related: [],
      concepts: [],
      origin: 'human',
      sources: [],
      bodyLinks: [],
      body: '',
      frontmatter: {}
    },
    error: null
  })

  it('sends later hydration chunks as incremental appends instead of full reloads', () => {
    const { result, unmount } = renderHook(() => useVaultWorker(vi.fn()))

    result.current.loadEntries([entry('/vault/a.md', 'a')])
    result.current.appendEntries([entry('/vault/b.md', 'b')])

    expect(workerMessages).toEqual([
      { type: 'load', entries: [entry('/vault/a.md', 'a')] },
      { type: 'append', entries: [entry('/vault/b.md', 'b')] }
    ])

    unmount()
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('sends a watcher delta as a single apply-delta message', () => {
    const { result, unmount } = renderHook(() => useVaultWorker(vi.fn()))

    result.current.applyDelta([entry('/vault/a.md', 'a')], ['/vault/b.md'])

    expect(workerMessages).toEqual([
      {
        type: 'apply-delta',
        upserts: [entry('/vault/a.md', 'a')],
        removes: ['/vault/b.md']
      }
    ])

    unmount()
  })
})
