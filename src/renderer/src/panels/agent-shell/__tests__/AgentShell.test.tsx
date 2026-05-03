import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { AgentShell } from '../AgentShell'
import type { VaultMachinaConfig } from '@shared/thread-storage-types'

const baseConfig: VaultMachinaConfig = {
  defaultAgent: 'machina-native',
  defaultModel: 'claude-sonnet-4-6',
  welcomed: false,
  customKeybindings: {}
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({ vaultPath: '/v' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      list: vi.fn().mockResolvedValue([]),
      listArchived: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockImplementation(async (_v: string, agent: string, model: string) => ({
        id: 'welcome-1',
        agent,
        model,
        started: '2026-05-01T00:00:00.000Z',
        lastMessage: '2026-05-01T00:00:00.000Z',
        title: 'Welcome',
        dockState: { tabs: [] },
        messages: []
      })),
      archive: vi.fn().mockResolvedValue(undefined),
      unarchive: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      readConfig: vi.fn().mockResolvedValue(baseConfig),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    },
    on: {
      agentNativeEvent: vi.fn().mockReturnValue(() => {}),
      threadCliMessage: vi.fn().mockReturnValue(() => {})
    }
  }
})

describe('AgentShell welcome tooltip', () => {
  it('renders the welcome tooltip on first launch when welcomed=false', async () => {
    render(<AgentShell />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-shell-welcome-tooltip')).toBeTruthy()
    })
  })

  it('does not render the tooltip when welcomed=true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.readConfig.mockResolvedValue({ ...baseConfig, welcomed: true })
    render(<AgentShell />)
    // Wait a tick for the effect to run, then assert it stays hidden.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('agent-shell-welcome-tooltip')).toBeNull()
  })

  it('renders a window drag region above the three-pane layout', () => {
    render(<AgentShell />)
    const strip = screen.getByTestId('window-drag-region')
    expect(strip).toBeTruthy()
    // happy-dom strips unknown CSS props (WebkitAppRegion), so we can only
    // assert the strip is mounted at the top of the shell. Real drag behavior
    // requires Electron and is verified by visual check.
    const shell = screen.getByTestId('agent-shell')
    expect(shell.firstChild).toBe(strip)
  })

  it('sizes the native controls container to the app header standard', () => {
    useVaultStore.setState({ vaultPath: null })
    render(<AgentShell />)
    const strip = screen.getByTestId('window-drag-region')
    const controls = screen.getByTestId('window-controls-container')
    expect(strip.style.height).toBe('39px')
    expect(controls.style.width).toBe('148px')
    expect(controls.style.height).toBe('39px')
  })

  it('dismissing flips welcomed and writes config', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeConfig = (window as any).api.thread.writeConfig
    render(<AgentShell />)
    const tooltip = await screen.findByTestId('agent-shell-welcome-tooltip')
    fireEvent.click(screen.getByText('got it'))
    expect(screen.queryByTestId('agent-shell-welcome-tooltip')).toBeNull()
    await waitFor(() => {
      expect(writeConfig).toHaveBeenCalledWith('/v', { ...baseConfig, welcomed: true })
    })
    expect(tooltip).toBeTruthy()
  })
})
