import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingOverlay } from '../OnboardingOverlay'
import { useClaudeStatusStore } from '../../store/claude-status-store'

interface ApiStub {
  claude: { recheck: ReturnType<typeof vi.fn> }
  agentNative: {
    setKey: ReturnType<typeof vi.fn>
    clearKey: ReturnType<typeof vi.fn>
  }
  shell: { openExternal: ReturnType<typeof vi.fn> }
}

function stubApi(overrides: { setKeyError?: Error } = {}) {
  const api: ApiStub = {
    claude: { recheck: vi.fn(async () => undefined) },
    agentNative: {
      setKey: vi.fn(async () => {
        if (overrides.setKeyError) throw overrides.setKeyError
      }),
      clearKey: vi.fn(async () => undefined)
    },
    shell: { openExternal: vi.fn(async () => undefined) }
  }
  ;(window as unknown as { api: ApiStub }).api = api
  return api
}

beforeEach(() => {
  stubApi()
  useClaudeStatusStore.setState(useClaudeStatusStore.getInitialState())
  useClaudeStatusStore.setState({ showOnboarding: true })
})

afterEach(() => {
  delete (window as unknown as { api?: ApiStub }).api
})

describe('OnboardingOverlay', () => {
  it('shows the API-key step first with a password input', () => {
    render(<OnboardingOverlay />)
    expect(screen.getByText('Connect Your Anthropic API Key')).toBeTruthy()
    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement
    expect(input.type).toBe('password')
    // CLI install content is not the default path
    expect(screen.queryByText('Install Claude Code')).toBeNull()
  })

  it('saves a trimmed key through agentNative.setKey, clears the input, and marks the store', async () => {
    const api = stubApi()
    render(<OnboardingOverlay />)
    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  sk-ant-test-123  ' } })
    fireEvent.click(screen.getByText('Save Key'))

    await screen.findByText('API Key Configured')
    expect(api.agentNative.setKey).toHaveBeenCalledWith('sk-ant-test-123')
    expect(useClaudeStatusStore.getState().nativeKeyConfigured).toBe(true)
    // The key never lingers in the DOM after save
    expect(document.body.innerHTML).not.toContain('sk-ant-test-123')
  })

  it('surfaces a save error without marking the key configured', async () => {
    stubApi({ setKeyError: new Error('safeStorage unavailable') })
    render(<OnboardingOverlay />)
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-bad' }
    })
    fireEvent.click(screen.getByText('Save Key'))

    await screen.findByText('safeStorage unavailable')
    expect(useClaudeStatusStore.getState().nativeKeyConfigured).toBe(false)
  })

  it('shows the configured state with a Clear Key path when a key already exists', async () => {
    const api = stubApi()
    useClaudeStatusStore.setState({ nativeKeyConfigured: true })
    render(<OnboardingOverlay />)
    expect(screen.getByText('API Key Configured')).toBeTruthy()

    fireEvent.click(screen.getByText('Clear Key'))
    await screen.findByLabelText('Anthropic API key')
    expect(api.agentNative.clearKey).toHaveBeenCalled()
    expect(useClaudeStatusStore.getState().nativeKeyConfigured).toBe(false)
  })

  it('offers the CLI install flow as the alternative path, with a way back', () => {
    render(<OnboardingOverlay />)
    fireEvent.click(screen.getByText('Install the Claude CLI instead'))
    expect(screen.getByText('Install Claude Code')).toBeTruthy()

    fireEvent.click(screen.getByText('Use an API key instead'))
    expect(screen.getByText('Connect Your Anthropic API Key')).toBeTruthy()
  })

  it('Escape dismisses the overlay', () => {
    render(<OnboardingOverlay />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(false)
  })
})
