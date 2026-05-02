import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

const mockAddDockTab = vi.fn()

const mockHealthState = {
  status: 'green' as 'green' | 'degraded' | 'unknown',
  runs: [] as Array<{ checkId: string; passed: boolean }>,
  issues: [] as Array<{ checkId: string; severity: string; title: string; detail: string }>,
  lastDerivedAt: null as number | null,
  lastInfraAt: null as number | null,
  setDerived: vi.fn(),
  setInfra: vi.fn(),
  reset: vi.fn()
}

// ---------------------------------------------------------------------------
// Store mocks (paths match what VaultSelector.tsx imports)
// ---------------------------------------------------------------------------

vi.mock('../../../store/vault-health-store', () => ({
  useVaultHealthStore: Object.assign(
    vi.fn((selector) => selector(mockHealthState)),
    { getState: vi.fn(() => mockHealthState) }
  )
}))

vi.mock('../../../store/thread-store', () => ({
  useThreadStore: Object.assign(
    vi.fn((selector) =>
      selector({
        addDockTab: mockAddDockTab,
        removeDockTab: vi.fn(),
        reorderDockTab: vi.fn()
      })
    ),
    {
      getState: vi.fn(() => ({
        addDockTab: mockAddDockTab,
        removeDockTab: vi.fn(),
        reorderDockTab: vi.fn()
      }))
    }
  )
}))

vi.mock('../../../design/tokens', () => ({
  colors: {
    bg: { base: '#0e1016', surface: '#12141c', elevated: '#1a1d28' },
    border: { default: 'rgba(255,255,255,0.08)', subtle: 'rgba(255,255,255,0.04)' },
    text: {
      primary: '#e0e4eb',
      secondary: '#a0a8b5',
      muted: '#5a6070',
      disabled: '#3e3e3e'
    },
    accent: {
      default: '#7c3aed',
      hover: '#8b5cf6',
      muted: 'rgba(124,58,237,0.1)',
      soft: 'rgba(124,58,237,0.14)',
      line: 'rgba(124,58,237,0.45)'
    },
    claude: { ready: '#4ec983', warning: '#dfa11a', error: '#ff847d' }
  },
  borderRadius: { container: 4, inline: 2, tool: 4, card: 0, round: '50%' },
  typography: {
    fontFamily: { display: 'system-ui', body: 'system-ui', mono: 'monospace' },
    metadata: { size: '10px', letterSpacing: '0.14em', textTransform: 'uppercase' as const }
  }
}))

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  currentName: 'Test Vault',
  currentPath: '/test-vault',
  history: [] as string[],
  onSelectVault: vi.fn(),
  onOpenPicker: vi.fn()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockHealthState.status = 'green'
  mockHealthState.runs = []
  mockHealthState.issues = []
  mockHealthState.lastDerivedAt = null
  mockHealthState.lastInfraAt = null
  mockAddDockTab.mockClear()
})

describe('VaultSelector health dot', () => {
  it('renders colored dot with correct fill when degraded', async () => {
    mockHealthState.status = 'degraded'
    mockHealthState.issues = [
      { checkId: 'parse-errors', severity: 'hard', title: 'Parse error', detail: 'Bad YAML' }
    ]

    const { VaultSelector } = await import('../VaultSelector')
    render(<VaultSelector {...defaultProps} />)

    const dot = screen.getByTestId('health-dot')
    expect(dot).toBeDefined()

    const circle = dot.querySelector('circle')
    expect(circle).not.toBeNull()
    expect(circle!.getAttribute('fill')).toBe('#dfa11a')
  })

  it('renders green dot when healthy', async () => {
    mockHealthState.status = 'green'

    const { VaultSelector } = await import('../VaultSelector')
    render(<VaultSelector {...defaultProps} />)

    const dot = screen.getByTestId('health-dot')
    expect(dot).toBeDefined()

    const circle = dot.querySelector('circle')
    expect(circle).not.toBeNull()
    expect(circle!.getAttribute('fill')).toBe('#7c3aed')
  })

  it('hides dot when no vault is open', async () => {
    const { VaultSelector } = await import('../VaultSelector')
    render(<VaultSelector {...defaultProps} currentPath={null} />)

    const dot = screen.queryByTestId('health-dot')
    expect(dot).toBeNull()
  })

  it('clicking degraded dot opens a health dock tab', async () => {
    mockHealthState.status = 'degraded'
    mockHealthState.issues = [
      { checkId: 'parse-errors', severity: 'hard', title: 'Parse error', detail: 'Bad YAML' }
    ]

    const { VaultSelector } = await import('../VaultSelector')
    render(<VaultSelector {...defaultProps} />)

    const dot = screen.getByTestId('health-dot')
    fireEvent.click(dot)

    expect(mockAddDockTab).toHaveBeenCalledWith({ kind: 'health' })
  })

  it('clicking green dot is a no-op', async () => {
    mockHealthState.status = 'green'

    const { VaultSelector } = await import('../VaultSelector')
    render(<VaultSelector {...defaultProps} />)

    const dot = screen.getByTestId('health-dot')
    fireEvent.click(dot)

    expect(mockAddDockTab).not.toHaveBeenCalled()
  })
})
