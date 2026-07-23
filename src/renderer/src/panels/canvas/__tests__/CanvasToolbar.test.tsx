import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../../store/canvas-store'
import { CanvasStoreProvider } from '../canvas-store-context'

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
    text: { primary: '#fff', secondary: '#aaa', muted: '#555', disabled: '#333' },
    accent: {
      default: '#7c3aed',
      hover: '#8b5cf6',
      muted: 'rgba(124,58,237,0.1)',
      soft: 'rgba(124,58,237,0.14)',
      line: 'rgba(124,58,237,0.45)'
    },
    border: { default: '#333', subtle: '#222' },
    claude: { warning: '#f00', error: '#f33' },
    semantic: { tension: '#ecaa0b' }
  },
  borderRadius: { container: 4, inline: 2, tool: 4, card: 0, round: '50%' },
  floatingPanel: {
    glass: { popoverBg: '#111', popoverBlur: 'blur(8px)' },
    shadowCompact: 'none'
  },
  iconSize: { sm: 14 },
  iconStroke: 1.75,
  typography: {
    fontFamily: { display: 'system-ui', body: 'system-ui', mono: 'monospace' },
    metadata: { size: '10px', letterSpacing: '0.14em', textTransform: 'uppercase' as const }
  }
}))

vi.mock('../canvas-tiling', () => ({
  TILE_PATTERNS: []
}))

vi.mock('@shared/canvas-types', () => ({
  createCanvasNode: vi.fn()
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

function renderToolbar(props: typeof baseProps) {
  const store = getCanvasStore(DEFAULT_CANVAS_ID)
  store.setState({ ...store.getInitialState(), nodes: [{ id: 'n1' }] as never })
  return render(
    <CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>
      <CanvasToolbar {...props} />
    </CanvasStoreProvider>
  )
}

describe('CanvasToolbar menus', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // Regression: reading e.currentTarget inside the setState updater crashed the
  // panel — currentTarget is nulled once the handler returns.
  it('opens the zoom menu on badge click', () => {
    renderToolbar(baseProps)
    fireEvent.click(screen.getByTestId('canvas-zoom-menu'))
    expect(screen.getByRole('menuitem', { name: 'Zoom to 100%' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Fit all' })).toBeTruthy()
  })

  it('opens the tile menu on tile-button click', () => {
    renderToolbar(baseProps)
    fireEvent.click(screen.getByTestId('canvas-tile'))
    expect(screen.getByRole('menuitem', { name: 'Organize by topic' })).toBeTruthy()
  })
})

describe('CanvasToolbar clear button', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders a clear button with data-testid="canvas-clear"', () => {
    renderToolbar(baseProps)
    expect(screen.getByTestId('canvas-clear')).toBeTruthy()
  })

  it('arms on first click without clearing, then calls onClear on confirm click', () => {
    const onClear = vi.fn()
    renderToolbar({ ...baseProps, onClear })

    const button = screen.getByTestId('canvas-clear')
    fireEvent.click(button)
    expect(onClear).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-label')).toBe('Confirm clear canvas')

    fireEvent.click(button)
    expect(onClear).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-label')).toBe('Clear canvas')
  })

  it('disarms after the confirm window times out', () => {
    vi.useFakeTimers()
    try {
      const onClear = vi.fn()
      renderToolbar({ ...baseProps, onClear })

      const button = screen.getByTestId('canvas-clear')
      fireEvent.click(button)
      expect(button.getAttribute('aria-label')).toBe('Confirm clear canvas')

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(button.getAttribute('aria-label')).toBe('Clear canvas')
      expect(onClear).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
