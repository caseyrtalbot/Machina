import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: vi.fn((selector) => {
    const state = {
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: vi.fn(),
      focusFrames: {},
      selectedNodeIds: new Set<string>(),
      nodes: [{ id: 'n1' }],
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
    accent: { default: '#7c3aed', hover: '#8b5cf6', muted: 'rgba(124,58,237,0.1)' },
    claude: { warning: '#f00' },
    semantic: { tension: '#ecaa0b' }
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

vi.stubGlobal('window', {
  ...globalThis.window,
  api: {
    fs: { fileExists: vi.fn(), writeFile: vi.fn() }
  }
})

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
  onClear: vi.fn()
}

describe('CanvasToolbar clear button', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders a clear button with data-testid="canvas-clear"', () => {
    render(<CanvasToolbar {...baseProps} />)
    expect(screen.getByTestId('canvas-clear')).toBeTruthy()
  })

  it('calls onClear when clear button is clicked and canvas has nodes', () => {
    const onClear = vi.fn()
    render(<CanvasToolbar {...baseProps} onClear={onClear} />)
    fireEvent.click(screen.getByTestId('canvas-clear'))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
