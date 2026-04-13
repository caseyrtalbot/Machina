import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
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
  useVaultHealthStore: vi.fn((selector) => selector(mockHealthState))
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

vi.mock('../../../store/tab-store', () => ({
  useTabStore: Object.assign(
    vi.fn((selector) =>
      selector({
        tabs: [],
        activeTabId: 'editor',
        openTab: vi.fn(),
        activateTab: vi.fn()
      })
    ),
    {
      getState: vi.fn(() => ({
        tabs: [],
        activeTabId: 'editor',
        openTab: vi.fn(),
        activateTab: vi.fn()
      }))
    }
  )
}))

vi.mock('../../../store/editor-store', () => ({
  useEditorStore: Object.assign(
    vi.fn((selector) =>
      selector({
        activeNotePath: null,
        openFile: vi.fn()
      })
    ),
    {
      getState: vi.fn(() => ({
        activeNotePath: null,
        openFile: vi.fn()
      }))
    }
  )
}))

vi.mock('../../../design/tokens', () => ({
  colors: {
    bg: { base: '#0e1016', surface: '#12141c', elevated: '#1a1d28' },
    border: { default: 'rgba(255,255,255,0.08)', subtle: 'rgba(255,255,255,0.04)' },
    text: { primary: '#e0e4eb', secondary: '#a0a8b5', muted: '#5a6070' },
    accent: { default: '#7c3aed', hover: '#8b5cf6', muted: 'rgba(124,58,237,0.1)' },
    claude: { ready: '#4ec983', warning: '#dfa11a', error: '#ff847d' }
  },
  typography: {
    fontFamily: {
      display: 'system-ui',
      body: 'system-ui',
      mono: 'monospace'
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
})
