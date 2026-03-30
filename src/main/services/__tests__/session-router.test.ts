// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webContents } from 'electron'

vi.mock('electron', () => ({
  webContents: { fromId: vi.fn() }
}))

import { register, unregister, getWebContents, clear } from '../session-router'

const mockFromId = vi.mocked(webContents.fromId)

function makeMockWebContents(id: number, destroyed = false) {
  return { id, send: vi.fn(), isDestroyed: () => destroyed } as unknown as Electron.WebContents
}

describe('SessionRouter', () => {
  beforeEach(() => {
    clear()
    mockFromId.mockReset()
  })

  it('returns the correct webContents after register', () => {
    const wc = makeMockWebContents(42)
    mockFromId.mockReturnValue(wc)

    register('session-1', 42)
    const result = getWebContents('session-1')

    expect(mockFromId).toHaveBeenCalledWith(42)
    expect(result).toBe(wc)
  })

  it('returns null after unregister', () => {
    const wc = makeMockWebContents(42)
    mockFromId.mockReturnValue(wc)

    register('session-1', 42)
    unregister('session-1')
    const result = getWebContents('session-1')

    expect(result).toBeNull()
  })

  it('returns null for unknown sessionId', () => {
    const result = getWebContents('unknown-session')

    expect(result).toBeNull()
  })

  it('returns null and auto-cleans when webContents is destroyed', () => {
    const wc = makeMockWebContents(42, true)
    mockFromId.mockReturnValue(wc)

    register('session-1', 42)
    const result = getWebContents('session-1')

    expect(result).toBeNull()
    // Verify auto-cleanup: a second lookup should not even call fromId
    mockFromId.mockClear()
    const result2 = getWebContents('session-1')
    expect(result2).toBeNull()
    expect(mockFromId).not.toHaveBeenCalled()
  })

  it('clear removes all entries', () => {
    const wc1 = makeMockWebContents(1)
    const wc2 = makeMockWebContents(2)
    mockFromId.mockImplementation((id) => {
      if (id === 1) return wc1
      if (id === 2) return wc2
      return undefined as unknown as Electron.WebContents
    })

    register('session-a', 1)
    register('session-b', 2)
    clear()

    expect(getWebContents('session-a')).toBeNull()
    expect(getWebContents('session-b')).toBeNull()
  })
})
