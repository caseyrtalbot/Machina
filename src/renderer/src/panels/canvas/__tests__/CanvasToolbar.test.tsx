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
    vi.fn((selector) => {
      const state = { vaultPath: '/test', rawFileCount: 42 }
      return selector(state)
    }),
    {
      getState: vi.fn(() => ({ vaultPath: '/test', rawFileCount: 42 }))
    }
  )
}))

vi.mock('../../../store/sidebar-selection-store', () => ({
  useSidebarSelectionStore: Object.assign(
    vi.fn((selector) => {
      const state = { selectedPaths: new Set<string>() }
      return selector(state)
    }),
    {
      getState: vi.fn(() => ({ selectedPaths: new Set<string>() }))
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
    text: { primary: '#fff', secondary: '#aaa', muted: '#555' },
    claude: { warning: '#f00' }
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

vi.mock('../../../hooks/use-claude-status', () => ({
  useClaudeStatus: vi.fn(() => ({ installed: true, authenticated: true }))
}))

const mockActionsList = vi.fn().mockResolvedValue([
  { id: 'emerge', name: 'Emerge', description: 'Surface connections', scope: 'any' },
  { id: 'librarian', name: 'Librarian', description: 'Audit vault', scope: 'vault' }
])

vi.stubGlobal('window', {
  ...globalThis.window,
  api: {
    fs: { fileExists: vi.fn(), writeFile: vi.fn() },
    actions: { list: mockActionsList }
  }
})

vi.mock('../ActionMenu', () => ({
  ActionMenu: ({
    scopeLabel,
    onSelect
  }: {
    scopeLabel: string
    onSelect: (id: string) => void
  }) => (
    <div data-testid="action-menu">
      <span data-testid="scope-label">{scopeLabel}</span>
      <button data-testid="action-emerge" onClick={() => onSelect('emerge')}>
        Emerge
      </button>
    </div>
  )
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
  onActionSelect: vi.fn()
}

describe('CanvasToolbar actions button', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders a button with data-testid="canvas-actions"', () => {
    render(<CanvasToolbar {...baseProps} />)
    const btn = screen.getByTestId('canvas-actions')
    expect(btn).toBeTruthy()
  })

  it('does not render librarian or curator buttons', () => {
    render(<CanvasToolbar {...baseProps} />)
    expect(screen.queryByTestId('canvas-librarian')).toBeNull()
    expect(screen.queryByTestId('canvas-curator')).toBeNull()
  })

  it('opens ActionMenu after clicking the actions button', async () => {
    render(<CanvasToolbar {...baseProps} />)
    expect(screen.queryByTestId('action-menu')).toBeNull()

    fireEvent.click(screen.getByTestId('canvas-actions'))

    // Wait for the async actions.list call to resolve
    await vi.waitFor(() => {
      expect(screen.getByTestId('action-menu')).toBeTruthy()
    })
  })

  it('shows vault scope label when no files selected', async () => {
    render(<CanvasToolbar {...baseProps} />)
    fireEvent.click(screen.getByTestId('canvas-actions'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('scope-label').textContent).toBe('Entire vault (42 notes)')
    })
  })

  it('calls actions.list IPC when opening flyout', async () => {
    render(<CanvasToolbar {...baseProps} />)
    fireEvent.click(screen.getByTestId('canvas-actions'))

    await vi.waitFor(() => {
      expect(mockActionsList).toHaveBeenCalled()
    })
  })

  it('calls onActionSelect when an action is chosen', async () => {
    const onActionSelect = vi.fn()
    render(<CanvasToolbar {...baseProps} onActionSelect={onActionSelect} />)
    fireEvent.click(screen.getByTestId('canvas-actions'))

    await vi.waitFor(() => {
      expect(screen.getByTestId('action-emerge')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('action-emerge'))
    expect(onActionSelect).toHaveBeenCalledWith('emerge')
  })

  it('closes the flyout when toggled again', async () => {
    render(<CanvasToolbar {...baseProps} />)
    const btn = screen.getByTestId('canvas-actions')

    fireEvent.click(btn)
    await vi.waitFor(() => {
      expect(screen.getByTestId('action-menu')).toBeTruthy()
    })

    fireEvent.click(btn)
    expect(screen.queryByTestId('action-menu')).toBeNull()
  })
})
