import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const mockHealthState = {
  status: 'green' as 'green' | 'degraded' | 'unknown',
  issues: [] as Array<{
    checkId: string
    severity: string
    title: string
    detail: string
    filePath?: string
  }>,
  runs: [] as Array<{ checkId: string; passed: boolean }>,
  lastDerivedAt: null as number | null,
  lastInfraAt: null as number | null,
  setDerived: vi.fn(),
  setInfra: vi.fn(),
  reset: vi.fn()
}

vi.mock('../../../store/vault-health-store', () => ({
  useVaultHealthStore: Object.assign(
    vi.fn((selector) => selector(mockHealthState)),
    {
      getState: vi.fn(() => mockHealthState)
    }
  )
}))

const mockVaultState = {
  vaultPath: '/test-vault' as string | null,
  artifacts: [],
  parseErrors: [],
  fileToId: {},
  artifactPathById: {},
  graph: null,
  files: []
}

vi.mock('../../../store/vault-store', () => ({
  useVaultStore: Object.assign(
    vi.fn((selector) => selector(mockVaultState)),
    {
      getState: vi.fn(() => mockVaultState)
    }
  )
}))

vi.mock('../../../store/thread-store', () => ({
  useThreadStore: Object.assign(
    vi.fn((selector) =>
      selector({
        openOrFocusDockTab: vi.fn()
      })
    ),
    {
      getState: vi.fn(() => ({
        openOrFocusDockTab: vi.fn()
      }))
    }
  )
}))

vi.mock('../../../store/editor-store', () => ({
  useEditorStore: Object.assign(
    vi.fn((selector) =>
      selector({
        activeNotePath: null,
        setActiveNote: vi.fn()
      })
    ),
    {
      getState: vi.fn(() => ({
        activeNotePath: null,
        setActiveNote: vi.fn()
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
    fontFamily: {
      display: 'system-ui',
      body: 'system-ui',
      mono: 'monospace'
    },
    metadata: {
      size: '10px',
      letterSpacing: '0.14em',
      textTransform: 'uppercase' as const
    }
  }
}))

vi.mock('@shared/engine/vault-health', () => ({
  computeDerivedHealth: vi.fn(() => ({
    runs: [],
    computedAt: Date.now()
  }))
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  // Reset mocks to defaults
  mockHealthState.status = 'green'
  mockHealthState.issues = []
  mockHealthState.runs = []
  mockHealthState.lastDerivedAt = null
  mockHealthState.lastInfraAt = null
  mockVaultState.vaultPath = '/test-vault'
})

describe('HealthPanel', () => {
  it('renders green state with check count and timestamp', async () => {
    const now = Date.now()
    mockHealthState.status = 'green'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.runs = [
      { checkId: 'parse-errors', passed: true },
      { checkId: 'broken-refs', passed: true },
      { checkId: 'stale-worker-index', passed: true },
      { checkId: 'vault-reachable', passed: true },
      { checkId: 'watcher-alive', passed: true },
      { checkId: 'worker-responsive', passed: true },
      { checkId: 'recent-disk-errors', passed: true }
    ]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    expect(screen.getByText('Vault healthy')).toBeDefined()
    expect(screen.getByText('7/7 checks passing')).toBeDefined()
  })

  it('renders unknown state with shimmer', async () => {
    mockHealthState.status = 'unknown'
    mockHealthState.lastDerivedAt = null
    mockHealthState.lastInfraAt = null

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    expect(screen.getByText('Checking vault health...')).toBeDefined()
  })

  it('renders no-vault state', async () => {
    mockVaultState.vaultPath = null

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    expect(screen.getByText('Open a vault to see health')).toBeDefined()
  })

  it('refresh button calls recompute', async () => {
    const now = Date.now()
    mockHealthState.status = 'green'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.runs = [{ checkId: 'parse-errors', passed: true }]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    const refreshBtn = screen.getByLabelText('Refresh health checks')
    expect(refreshBtn).toBeDefined()
    fireEvent.click(refreshBtn)

    // computeDerivedHealth should have been called
    const { computeDerivedHealth } = await import('@shared/engine/vault-health')
    expect(computeDerivedHealth).toHaveBeenCalled()
  })

  it('renders degraded state with grouped issues', async () => {
    const now = Date.now()
    mockHealthState.status = 'degraded'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.issues = [
      {
        checkId: 'parse-errors',
        severity: 'hard',
        title: 'Parse error in note',
        detail: 'Invalid YAML frontmatter',
        filePath: '/vault/broken.md'
      },
      {
        checkId: 'broken-refs',
        severity: 'hard',
        title: 'Broken reference',
        detail: 'Link target does not exist',
        filePath: '/vault/missing-ref.md'
      },
      {
        checkId: 'stale-worker-index',
        severity: 'integrity',
        title: 'Stale worker index',
        detail: 'Index is 5 minutes behind disk'
      }
    ]
    mockHealthState.runs = [
      { checkId: 'parse-errors', passed: false },
      { checkId: 'broken-refs', passed: false },
      { checkId: 'stale-worker-index', passed: false }
    ]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    expect(screen.getByText('HARD FAILURES')).toBeDefined()
    expect(screen.getByText('INTEGRITY')).toBeDefined()
    expect(screen.getByText('Parse error in note')).toBeDefined()
    expect(screen.getByText('Stale worker index')).toBeDefined()
  })

  it('clicking file link calls setActiveNote and opens an editor dock tab', async () => {
    const now = Date.now()
    const mockOpenOrFocus = vi.fn()
    const mockSetActiveNote = vi.fn()

    const { useThreadStore } = await import('../../../store/thread-store')
    ;(useThreadStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      openOrFocusDockTab: mockOpenOrFocus
    })

    const { useEditorStore } = await import('../../../store/editor-store')
    ;(useEditorStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      activeNotePath: null,
      setActiveNote: mockSetActiveNote
    })

    mockHealthState.status = 'degraded'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.issues = [
      {
        checkId: 'parse-errors',
        severity: 'hard',
        title: 'Parse error',
        detail: 'Bad YAML',
        filePath: '/vault/broken.md'
      }
    ]
    mockHealthState.runs = [{ checkId: 'parse-errors', passed: false }]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    const fileLink = screen.getByText('broken.md')
    fireEvent.click(fileLink)

    expect(mockSetActiveNote).toHaveBeenCalledWith('/vault/broken.md')
    expect(mockOpenOrFocus).toHaveBeenCalledWith({ kind: 'editor', path: '/vault/broken.md' })
  })

  it('refresh button disables for 500ms after click', async () => {
    const now = Date.now()
    mockHealthState.status = 'green'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.runs = [{ checkId: 'parse-errors', passed: true }]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    const refreshBtn = screen.getByLabelText('Refresh health checks') as HTMLButtonElement
    fireEvent.click(refreshBtn)

    expect(refreshBtn.disabled).toBe(true)
  })

  it('groups hard issues before integrity', async () => {
    const now = Date.now()
    mockHealthState.status = 'degraded'
    mockHealthState.lastDerivedAt = now
    mockHealthState.lastInfraAt = now
    mockHealthState.issues = [
      {
        checkId: 'stale-worker-index',
        severity: 'integrity',
        title: 'Stale index',
        detail: 'Index is behind'
      },
      {
        checkId: 'parse-errors',
        severity: 'hard',
        title: 'Parse error',
        detail: 'Bad YAML'
      }
    ]
    mockHealthState.runs = [
      { checkId: 'stale-worker-index', passed: false },
      { checkId: 'parse-errors', passed: false }
    ]

    const { HealthPanel } = await import('../HealthPanel')
    render(<HealthPanel />)

    const sections = screen.getAllByRole('heading', { level: 3 })
    expect(sections[0].textContent).toBe('HARD FAILURES')
    expect(sections[1].textContent).toBe('INTEGRITY')
  })
})
