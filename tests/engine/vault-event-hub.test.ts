import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.api.on.filesChangedBatch before importing the module
let capturedCallback:
  | ((data: { events: readonly { path: string; event: string }[] }) => void)
  | null = null

vi.stubGlobal('window', {
  api: {
    on: {
      filesChangedBatch: vi.fn((cb: typeof capturedCallback) => {
        capturedCallback = cb
        return () => {
          capturedCallback = null
        }
      })
    }
  }
})

// Import after mock is set up
const { vaultEvents } = await import('../../src/renderer/src/engine/vault-event-hub')

function emit(events: { path: string; event: 'add' | 'change' | 'unlink' }[]): void {
  capturedCallback?.({ events })
}

describe('VaultEventHub', () => {
  beforeEach(() => {
    // Reset by ensuring IPC is subscribed (hub is a singleton)
  })

  it('dispatches to path-specific listeners', () => {
    const listener = vi.fn()
    const unsub = vaultEvents.subscribePath('/vault/note.md', listener)

    emit([{ path: '/vault/note.md', event: 'change' }])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ path: '/vault/note.md', event: 'change' })

    unsub()
  })

  it('does not dispatch to other paths', () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubA = vaultEvents.subscribePath('/vault/a.md', listenerA)
    const unsubB = vaultEvents.subscribePath('/vault/b.md', listenerB)

    emit([{ path: '/vault/a.md', event: 'change' }])

    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).not.toHaveBeenCalled()

    unsubA()
    unsubB()
  })

  it('dispatches to batch listeners with full event array', () => {
    const listener = vi.fn()
    const unsub = vaultEvents.subscribeBatch(listener)

    const events = [
      { path: '/vault/a.md', event: 'change' as const },
      { path: '/vault/b.md', event: 'add' as const }
    ]
    emit(events)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(events)

    unsub()
  })

  it('dispatches to any-listeners for every event', () => {
    const listener = vi.fn()
    const unsub = vaultEvents.subscribeAny(listener)

    emit([
      { path: '/vault/a.md', event: 'change' },
      { path: '/vault/b.md', event: 'add' }
    ])

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledWith({ path: '/vault/a.md', event: 'change' })
    expect(listener).toHaveBeenCalledWith({ path: '/vault/b.md', event: 'add' })

    unsub()
  })

  it('unsubscribe stops delivery', () => {
    const listener = vi.fn()
    const unsub = vaultEvents.subscribePath('/vault/note.md', listener)

    unsub()

    emit([{ path: '/vault/note.md', event: 'change' }])
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribe during dispatch is safe (no iterator invalidation)', () => {
    const calls: string[] = []
    let unsubSelf: (() => void) | null = null

    // Listener that unsubscribes itself when called
    unsubSelf = vaultEvents.subscribePath('/vault/note.md', () => {
      calls.push('self-unsub')
      unsubSelf?.()
    })

    const unsubOther = vaultEvents.subscribePath('/vault/note.md', () => {
      calls.push('other')
    })

    // Should not throw despite mid-iteration unsubscribe
    emit([{ path: '/vault/note.md', event: 'change' }])

    expect(calls).toContain('self-unsub')
    expect(calls).toContain('other')

    unsubOther()
  })

  it('ignores empty event batches', () => {
    const batchListener = vi.fn()
    const anyListener = vi.fn()
    const unsubBatch = vaultEvents.subscribeBatch(batchListener)
    const unsubAny = vaultEvents.subscribeAny(anyListener)

    emit([])

    expect(batchListener).not.toHaveBeenCalled()
    expect(anyListener).not.toHaveBeenCalled()

    unsubBatch()
    unsubAny()
  })

  it('cleans up path entry when last listener unsubscribes', () => {
    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const unsub1 = vaultEvents.subscribePath('/vault/note.md', listener1)
    const unsub2 = vaultEvents.subscribePath('/vault/note.md', listener2)

    unsub1()
    unsub2()

    // After both unsubscribe, emitting should not call either
    emit([{ path: '/vault/note.md', event: 'change' }])
    expect(listener1).not.toHaveBeenCalled()
    expect(listener2).not.toHaveBeenCalled()
  })
})
