import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentShellKeybindings } from '../keybindings'
import { useThreadStore } from '../../../store/thread-store'

function fireKey(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
})

describe('useAgentShellKeybindings — Cmd+. abort', () => {
  it('cancels the active in-flight run on Cmd+.', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: { t1: true },
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    fireKey({ key: '.', metaKey: true })

    expect(cancelActive).toHaveBeenCalledWith('t1')
  })

  it('does nothing when no run is in flight', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: {},
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    fireKey({ key: '.', metaKey: true })

    expect(cancelActive).not.toHaveBeenCalled()
  })

  it('aborts even when the focus is in a textarea (composer)', () => {
    const cancelActive = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({
      activeThreadId: 't1',
      inFlightByThreadId: { t1: true },
      cancelActive
    })
    const opts = { toggleDock: vi.fn(), openPalette: vi.fn(), closePalette: vi.fn() }
    renderHook(() => useAgentShellKeybindings(opts))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    try {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true })
      )
      expect(cancelActive).toHaveBeenCalledWith('t1')
    } finally {
      textarea.remove()
    }
  })
})
