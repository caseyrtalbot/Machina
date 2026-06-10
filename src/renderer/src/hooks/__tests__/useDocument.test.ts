import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { setErrorNotifier } from '../../utils/error-logger'

type Handler<T> = (data: T) => void

const handlers = {
  saved: null as Handler<{ path: string }> | null,
  saveFailed: null as Handler<{ path: string; message: string }> | null
}

const mockOpen = vi.fn()
const mockClose = vi.fn()
const mockUpdate = vi.fn()
const mockSave = vi.fn()

// Attach api to the real happy-dom window so testing-library's document
// wiring stays intact.
;(window as unknown as { api: unknown }).api = {
  document: {
    open: mockOpen,
    close: mockClose,
    update: mockUpdate,
    save: mockSave
  },
  on: {
    docExternalChange: vi.fn(() => () => {}),
    docConflict: vi.fn(() => () => {}),
    docSaved: vi.fn((cb: Handler<{ path: string }>) => {
      handlers.saved = cb
      return () => {}
    }),
    docSaveFailed: vi.fn((cb: Handler<{ path: string; message: string }>) => {
      handlers.saveFailed = cb
      return () => {}
    })
  }
}

const { useDocument } = await import('../useDocument')

async function renderOpenDocument(path: string) {
  const rendered = renderHook(() => useDocument(path))
  // Settle the doc:open promise so loading flips false.
  await act(async () => {
    await Promise.resolve()
  })
  expect(rendered.result.current.loading).toBe(false)
  return rendered
}

describe('useDocument save-failed surfacing', () => {
  const notify = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    handlers.saved = null
    handlers.saveFailed = null
    mockOpen.mockResolvedValue({ content: '# Note', version: 0 })
    mockClose.mockResolvedValue(undefined)
    mockSave.mockResolvedValue(undefined)
    setErrorNotifier(notify)
  })

  afterEach(() => {
    setErrorNotifier(() => {})
    cleanup()
  })

  it('sets saveError, stays dirty, and toasts on doc:save-failed', async () => {
    const { result } = await renderOpenDocument('/vault/note.md')

    act(() => result.current.update('# Edited'))
    expect(result.current.isDirty).toBe(true)

    act(() => handlers.saveFailed?.({ path: '/vault/note.md', message: 'ENOSPC' }))

    expect(result.current.saveError).toBe('ENOSPC')
    expect(result.current.isDirty).toBe(true)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'))
  })

  it('ignores save-failed events for other paths', async () => {
    const { result } = await renderOpenDocument('/vault/note.md')

    act(() => handlers.saveFailed?.({ path: '/vault/other.md', message: 'ENOSPC' }))

    expect(result.current.saveError).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('clears saveError once a save succeeds', async () => {
    const { result } = await renderOpenDocument('/vault/note.md')

    act(() => result.current.update('# Edited'))
    act(() => handlers.saveFailed?.({ path: '/vault/note.md', message: 'ENOSPC' }))
    expect(result.current.saveError).toBe('ENOSPC')

    act(() => handlers.saved?.({ path: '/vault/note.md' }))

    expect(result.current.saveError).toBeNull()
    expect(result.current.isDirty).toBe(false)
  })
})
