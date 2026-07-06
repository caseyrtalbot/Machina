import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────

let mockVaultPath: string | null = '/test/vault'
vi.mock('../../../../store/vault-store', () => ({
  useVaultStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ vaultPath: mockVaultPath })
}))

// Mock window.api — assign onto existing window to preserve happy-dom globals
const mockGetTerminalPreloadPath = vi.fn(() => '/path/to/preload/terminal-webview.js')
;(window as unknown as Record<string, unknown>).api = {
  getTerminalPreloadPath: mockGetTerminalPreloadPath
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getWebview(container: HTMLElement): HTMLElement {
  const webview = container.querySelector('webview') as HTMLElement | null
  expect(webview).toBeTruthy()
  return webview as HTMLElement
}

function dispatchWebviewEvent(
  webview: HTMLElement,
  type: string,
  extra?: Record<string, unknown>
): void {
  const event = new Event(type)
  if (extra) Object.assign(event, extra)
  webview.dispatchEvent(event)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TerminalDockAdapter (webview host)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockVaultPath = '/test/vault'
  })

  it('invokes onSessionCreated with the sessionId from a session-created ipc-message', async () => {
    const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
    const onSessionCreated = vi.fn()
    const { container } = render(
      <TerminalDockAdapter sessionId="" onSessionCreated={onSessionCreated} />
    )
    const webview = getWebview(container)

    await act(async () => {
      dispatchWebviewEvent(webview, 'ipc-message', {
        channel: 'session-created',
        args: ['sess-live']
      })
    })

    expect(onSessionCreated).toHaveBeenCalledTimes(1)
    expect(onSessionCreated).toHaveBeenCalledWith('sess-live')
  })

  it('invokes onSessionExited on a session-exited ipc-message', async () => {
    const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
    const onSessionExited = vi.fn()
    const { container } = render(
      <TerminalDockAdapter sessionId="sess-1" onSessionExited={onSessionExited} />
    )
    const webview = getWebview(container)

    await act(async () => {
      dispatchWebviewEvent(webview, 'ipc-message', {
        channel: 'session-exited',
        args: ['sess-1', 0]
      })
    })

    expect(onSessionExited).toHaveBeenCalledTimes(1)
  })

  it('ignores ipc-messages on unrelated channels', async () => {
    const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
    const onSessionCreated = vi.fn()
    const onSessionExited = vi.fn()
    const { container } = render(
      <TerminalDockAdapter
        sessionId=""
        onSessionCreated={onSessionCreated}
        onSessionExited={onSessionExited}
      />
    )
    const webview = getWebview(container)

    await act(async () => {
      dispatchWebviewEvent(webview, 'ipc-message', {
        channel: 'something-else',
        args: ['sess-x']
      })
    })

    expect(onSessionCreated).not.toHaveBeenCalled()
    expect(onSessionExited).not.toHaveBeenCalled()
  })

  it('fires the latest onSessionCreated after a callback-identity re-render (latest-ref)', async () => {
    const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
    const firstCallback = vi.fn()
    const { container, rerender } = render(
      <TerminalDockAdapter sessionId="" onSessionCreated={firstCallback} />
    )
    const webview = getWebview(container)

    const secondCallback = vi.fn()
    rerender(<TerminalDockAdapter sessionId="" onSessionCreated={secondCallback} />)

    // Same webview element: the listener must not have been torn down by the
    // callback identity change.
    expect(container.querySelector('webview')).toBe(webview)

    await act(async () => {
      dispatchWebviewEvent(webview, 'ipc-message', {
        channel: 'session-created',
        args: ['sess-after-rerender']
      })
    })

    expect(firstCallback).not.toHaveBeenCalled()
    expect(secondCallback).toHaveBeenCalledTimes(1)
    expect(secondCallback).toHaveBeenCalledWith('sess-after-rerender')
  })

  it('does not throw when session events arrive with no callbacks provided', async () => {
    const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
    const { container } = render(<TerminalDockAdapter sessionId="" />)
    const webview = getWebview(container)

    await act(async () => {
      expect(() => {
        dispatchWebviewEvent(webview, 'ipc-message', {
          channel: 'session-created',
          args: ['sess-orphan']
        })
        dispatchWebviewEvent(webview, 'ipc-message', {
          channel: 'session-exited',
          args: ['sess-orphan', 0]
        })
      }).not.toThrow()
    })
  })

  describe('webview src URL', () => {
    it('includes the cwd param when the cwd prop is set', async () => {
      const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
      const { container } = render(<TerminalDockAdapter sessionId="" cwd="/custom/dir" />)

      const src = getWebview(container).getAttribute('src') ?? ''
      expect(src).toContain('cwd=%2Fcustom%2Fdir')
    })

    it('falls back to the vault path for cwd when the cwd prop is omitted', async () => {
      const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
      const { container } = render(<TerminalDockAdapter sessionId="" />)

      const src = getWebview(container).getAttribute('src') ?? ''
      expect(src).toContain('cwd=%2Ftest%2Fvault')
      expect(src).toContain('vaultPath=%2Ftest%2Fvault')
    })

    it('includes sessionId when non-empty', async () => {
      const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
      const { container } = render(<TerminalDockAdapter sessionId="sess-persisted" />)

      const src = getWebview(container).getAttribute('src') ?? ''
      expect(src).toContain('sessionId=sess-persisted')
    })

    it('omits sessionId when empty', async () => {
      const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
      const { container } = render(<TerminalDockAdapter sessionId="" />)

      const src = getWebview(container).getAttribute('src') ?? ''
      expect(src).not.toContain('sessionId=')
    })

    it('sets the webview preload path from window.api', async () => {
      const { TerminalDockAdapter } = await import('../TerminalDockAdapter')
      const { container } = render(<TerminalDockAdapter sessionId="" />)

      expect(getWebview(container).getAttribute('preload')).toBe(
        'file:///path/to/preload/terminal-webview.js'
      )
    })
  })
})
