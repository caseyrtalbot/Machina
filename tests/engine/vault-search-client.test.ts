import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerSearchWorker,
  deliverSearchResults,
  searchVault
} from '@renderer/engine/vault-search'
import type { SearchWorkerPort } from '@renderer/engine/vault-search'
import type { SearchHit } from '@shared/engine/search-engine'

const hit = (path: string): SearchHit => ({
  id: path,
  title: path,
  path,
  snippet: 'snippet',
  score: 1
})

function fakePort(): SearchWorkerPort & {
  sent: Array<{ type: 'search'; requestId: number; query: string; limit?: number }>
} {
  const sent: Array<{ type: 'search'; requestId: number; query: string; limit?: number }> = []
  return {
    sent,
    postMessage: (msg) => {
      if (msg.type === 'search') sent.push(msg)
    }
  }
}

afterEach(() => {
  registerSearchWorker(null)
  vi.useRealTimers()
})

describe('vault-search client', () => {
  it('resolves a query with the hits delivered for its requestId', async () => {
    const port = fakePort()
    registerSearchWorker(port)

    const p1 = searchVault('alpha', 5)
    const p2 = searchVault('beta')
    expect(port.sent.map((m) => m.query)).toEqual(['alpha', 'beta'])
    const [req1, req2] = port.sent

    // Deliver out of order: each promise gets its own requestId's hits.
    deliverSearchResults({ requestId: req2.requestId, hits: [hit('/v/b.md')] })
    deliverSearchResults({ requestId: req1.requestId, hits: [hit('/v/a.md')] })

    expect((await p1).map((h) => h.path)).toEqual(['/v/a.md'])
    expect((await p2).map((h) => h.path)).toEqual(['/v/b.md'])
  })

  it('resolves empty without posting when the query is blank or no worker is registered', async () => {
    const port = fakePort()
    registerSearchWorker(port)
    expect(await searchVault('   ')).toEqual([])
    expect(port.sent).toHaveLength(0)

    registerSearchWorker(null)
    expect(await searchVault('alpha')).toEqual([])
  })

  it('resolves in-flight queries empty when the worker unregisters', async () => {
    const port = fakePort()
    registerSearchWorker(port)
    const p = searchVault('alpha')
    registerSearchWorker(null)
    expect(await p).toEqual([])
  })

  it('times out to empty hits when the worker never answers', async () => {
    vi.useFakeTimers()
    const port = fakePort()
    registerSearchWorker(port)
    const p = searchVault('alpha')
    vi.advanceTimersByTime(5001)
    expect(await p).toEqual([])
    // A late delivery for the expired request is ignored, not crashed on.
    deliverSearchResults({ requestId: port.sent[0].requestId, hits: [hit('/v/a.md')] })
  })
})
