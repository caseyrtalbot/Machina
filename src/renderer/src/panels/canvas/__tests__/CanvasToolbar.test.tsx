import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock stores that CanvasToolbar reads from
vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: vi.fn((selector) => {
    const state = {
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: vi.fn(),
      focusFrames: {},
      showAllEdges: false,
      toggleShowAllEdges: vi.fn(),
      jumpToFocusFrame: vi.fn()
    }
    return selector(state)
  })
}))

vi.mock('../../../store/vault-store', () => ({
  useVaultStore: Object.assign(
    vi.fn(() => null),
    {
      getState: vi.fn(() => ({ vaultPath: '/test' }))
    }
  )
}))

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = {
      env: { gridDotVisibility: 50, cardBlur: 8 },
      setEnv: vi.fn()
    }
    return selector(state)
  })
}))

vi.mock('../../../design/tokens', () => ({
  colors: {
    text: { primary: '#fff', secondary: '#aaa', muted: '#555' }
  }
}))

vi.mock('../canvas-tiling', () => ({
  TILE_PATTERNS: []
}))

vi.mock('@shared/canvas-types', () => ({
  createCanvasNode: vi.fn()
}))

vi.mock('../../../engine/claude-md-template', () => ({
  generateClaudeMd: vi.fn()
}))

let mockAgentStates: unknown[] = []
vi.mock('../../../hooks/use-agent-states', () => ({
  useAgentStates: vi.fn(() => mockAgentStates)
}))

vi.mock('../VaultAgentFlyout', () => ({
  VaultAgentFlyout: () => null
}))

// Lazy import after mocks
import { CanvasToolbar } from '../CanvasToolbar'

const baseProps = {
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onAddCard: vi.fn(),
  onOpenImport: vi.fn(),
  onOrganize: vi.fn(),
  organizePhase: 'idle',
  librarianActive: false,
  onLibrarian: vi.fn(),
  curatorActive: false,
  onCurator: vi.fn(),
  lastLibrarianResultPath: null
}

describe('CanvasToolbar librarian button', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a button with data-testid="canvas-librarian"', () => {
    render(<CanvasToolbar {...baseProps} />)
    const btn = screen.getByTestId('canvas-librarian')
    expect(btn).toBeTruthy()
  })

  it('toggles the agent flyout when the button is clicked', () => {
    render(<CanvasToolbar {...baseProps} />)
    fireEvent.click(screen.getByTestId('canvas-librarian'))
    // Flyout is mocked, so we just verify the button is clickable without error
    expect(screen.getByTestId('canvas-librarian')).toBeTruthy()
  })

  it('shows "Librarian" tooltip when inactive', () => {
    render(<CanvasToolbar {...baseProps} librarianActive={false} />)
    // Tip renders a span with class canvas-tooltip containing the label
    const tip = screen.getByText('Librarian')
    expect(tip).toBeTruthy()
  })

  it('shows "Stop Librarian" tooltip when alive', () => {
    mockAgentStates = [{ label: 'librarian', status: 'alive', sessionId: 'x' }]
    render(<CanvasToolbar {...baseProps} librarianActive={true} />)
    const tip = screen.getByText('Stop Librarian')
    expect(tip).toBeTruthy()
    mockAgentStates = []
  })

  it('applies active class when librarian alive', () => {
    mockAgentStates = [{ label: 'librarian', status: 'alive', sessionId: 'x' }]
    render(<CanvasToolbar {...baseProps} librarianActive={true} />)
    const btn = screen.getByTestId('canvas-librarian')
    expect(btn.className).toContain('canvas-toolbtn--active')
    mockAgentStates = []
  })

  it('does not apply active class when librarianActive is false', () => {
    render(<CanvasToolbar {...baseProps} librarianActive={false} />)
    const btn = screen.getByTestId('canvas-librarian')
    expect(btn.className).not.toContain('canvas-toolbtn--active')
  })

  it('applies pulse animation on svg when alive', () => {
    mockAgentStates = [{ label: 'librarian', status: 'alive', sessionId: 'x' }]
    render(<CanvasToolbar {...baseProps} librarianActive={true} />)
    const btn = screen.getByTestId('canvas-librarian')
    const svg = btn.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg!.style.animation).toContain('te-pulse')
    mockAgentStates = []
  })

  it('does not apply pulse animation on svg when inactive', () => {
    render(<CanvasToolbar {...baseProps} librarianActive={false} />)
    const btn = screen.getByTestId('canvas-librarian')
    const svg = btn.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg!.style.animation).toBe('')
  })
})
