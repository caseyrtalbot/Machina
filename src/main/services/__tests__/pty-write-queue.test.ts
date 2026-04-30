// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PtyWriteQueue, type PtyWrite } from '../pty-write-queue'

describe('PtyWriteQueue', () => {
  it('drains writes in enqueue order regardless of kind', async () => {
    const queue = new PtyWriteQueue()
    const seen: PtyWrite[] = []

    queue.enqueue({ kind: 'command', text: 'ls' })
    queue.enqueue({ kind: 'agent-input', mode: 'batched', data: 'hi' })
    queue.enqueue({ kind: 'bytes', data: '\x03' })

    await queue.drain((w) => {
      seen.push(w)
    })

    expect(seen.map((w) => w.kind)).toEqual(['command', 'agent-input', 'bytes'])
  })

  it('serializes concurrent drain calls (single flight)', async () => {
    const queue = new PtyWriteQueue()
    let inFlight = 0
    let maxInFlight = 0

    const slow = async (): Promise<void> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    }

    queue.enqueue({ kind: 'bytes', data: 'a' })
    queue.enqueue({ kind: 'bytes', data: 'b' })
    queue.enqueue({ kind: 'bytes', data: 'c' })

    await Promise.all([queue.drain(slow), queue.drain(slow)])

    expect(maxInFlight).toBe(1)
  })

  it('handles empty queue cleanly', async () => {
    const queue = new PtyWriteQueue()
    const seen: PtyWrite[] = []
    await queue.drain((w) => {
      seen.push(w)
    })
    expect(seen).toEqual([])
  })

  it('processes writes enqueued during a drain', async () => {
    const queue = new PtyWriteQueue()
    const seen: PtyWrite[] = []

    queue.enqueue({ kind: 'bytes', data: 'a' })

    await queue.drain((w) => {
      seen.push(w)
      if (w.kind === 'bytes' && w.data === 'a') {
        // Enqueue another item while draining; queue should pick it up.
        queue.enqueue({ kind: 'bytes', data: 'b' })
      }
    })

    expect(seen.map((w) => (w.kind === 'bytes' ? w.data : ''))).toEqual(['a', 'b'])
  })
})
