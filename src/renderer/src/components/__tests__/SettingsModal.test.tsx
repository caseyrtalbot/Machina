import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from '../SettingsModal'

interface ApiStub {
  embeddings: {
    status: ReturnType<typeof vi.fn>
    setEnabled: ReturnType<typeof vi.fn>
  }
  agentNative: {
    hasKey: ReturnType<typeof vi.fn>
    setKey: ReturnType<typeof vi.fn>
    clearKey: ReturnType<typeof vi.fn>
  }
  mcp: { status: ReturnType<typeof vi.fn> }
  app: { revealLogs: ReturnType<typeof vi.fn> }
}

function stubApi(): ApiStub {
  const api: ApiStub = {
    embeddings: {
      status: vi.fn(async () => ({ enabled: false, state: 'off' as const, docCount: 0 })),
      setEnabled: vi.fn(async () => undefined)
    },
    agentNative: {
      hasKey: vi.fn(async () => false),
      setKey: vi.fn(async () => undefined),
      clearKey: vi.fn(async () => undefined)
    },
    mcp: { status: vi.fn(async () => ({ running: false })) },
    app: { revealLogs: vi.fn(async () => undefined) }
  }
  ;(window as unknown as { api: ApiStub }).api = api
  return api
}

beforeEach(() => {
  stubApi()
})

afterEach(() => {
  delete (window as unknown as { api?: ApiStub }).api
})

describe('SettingsModal', () => {
  it('renders when open', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('Escape calls the close path', () => {
    const onClose = vi.fn()
    render(<SettingsModal isOpen onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('scrim mousedown closes', () => {
    const onClose = vi.fn()
    render(<SettingsModal isOpen onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    const backdrop = dialog.parentElement as HTMLElement
    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('remains in the DOM (inert) when closed, since keepMounted preserves internal state', () => {
    const onClose = vi.fn()
    const { rerender } = render(<SettingsModal isOpen onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeTruthy()

    rerender(<SettingsModal isOpen={false} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    const backdrop = dialog.parentElement as HTMLElement
    expect(backdrop.style.pointerEvents).toBe('none')
  })
})
