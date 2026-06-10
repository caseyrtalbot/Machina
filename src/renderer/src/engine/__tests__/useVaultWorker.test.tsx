import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultWorker } from '../useVaultWorker'

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

  it('sends later hydration chunks as incremental appends instead of full reloads', () => {
    const { result, unmount } = renderHook(() => useVaultWorker(vi.fn()))

    result.current.loadFiles([{ path: '/vault/a.md', content: 'A' }])
    result.current.appendFiles([{ path: '/vault/b.md', content: 'B' }])

    expect(workerMessages).toEqual([
      { type: 'load', files: [{ path: '/vault/a.md', content: 'A' }] },
      { type: 'append', files: [{ path: '/vault/b.md', content: 'B' }] }
    ])

    unmount()
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('sends a watcher batch as a single update-many message', () => {
    const { result, unmount } = renderHook(() => useVaultWorker(vi.fn()))

    result.current.updateMany([{ path: '/vault/a.md', content: 'A2' }], ['/vault/b.md'])

    expect(workerMessages).toEqual([
      {
        type: 'update-many',
        updates: [{ path: '/vault/a.md', content: 'A2' }],
        removes: ['/vault/b.md']
      }
    ])

    unmount()
  })
})
