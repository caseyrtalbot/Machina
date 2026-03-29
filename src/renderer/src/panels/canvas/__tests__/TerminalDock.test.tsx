import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '@shared/canvas-types'
import type { TerminalStatus } from '../useTerminalStatus'

// --- Controlled mock state ---

let mockNodes: readonly CanvasNode[] = []
const mockSetViewport = vi.fn()
const mockSetFocusedTerminal = vi.fn()
const mockSetSelection = vi.fn()

vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        nodes: mockNodes,
        setViewport: mockSetViewport,
        setFocusedTerminal: mockSetFocusedTerminal,
        setSelection: mockSetSelection
      }),
    {
      getState: () => ({
        nodes: mockNodes,
        setViewport: mockSetViewport,
        setFocusedTerminal: mockSetFocusedTerminal,
        setSelection: mockSetSelection
      })
    }
  )
}))

let mockStatuses: readonly TerminalStatus[] = []

vi.mock('../useTerminalStatus', () => ({
  useTerminalStatus: () => mockStatuses
}))

// Dynamic import after mocks are registered
const { TerminalDock } = await import('../TerminalDock')

// --- Helpers ---

function makeTerminalNode(
  id: string,
  meta?: Partial<Record<string, unknown>>,
  position?: { x: number; y: number },
  size?: { width: number; height: number }
): CanvasNode {
  return {
    id,
    type: 'terminal',
    position: position ?? { x: 100, y: 200 },
    size: size ?? { width: 320, height: 240 },
    content: `session-${id}`,
    metadata: {
      initialCwd: '/Users/casey/projects/demo',
      ...meta
    }
  }
}

function makeTextNode(id: string): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 160 },
    content: 'Hello world',
    metadata: {}
  }
}

function makeStatus(
  nodeId: string,
  status: TerminalStatus['status'] = 'idle',
  label = 'demo',
  processName = 'zsh'
): TerminalStatus {
  return { nodeId, sessionId: `session-${nodeId}`, label, status, processName }
}

describe('TerminalDock', () => {
  beforeEach(() => {
    mockNodes = []
    mockStatuses = []
    mockSetViewport.mockReset()
    mockSetFocusedTerminal.mockReset()
    mockSetSelection.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when zero terminal nodes exist', () => {
    mockNodes = [makeTextNode('t1'), makeTextNode('t2')]
    mockStatuses = []

    const { container } = render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders one pill per terminal in expanded state', () => {
    const n1 = makeTerminalNode('term-1')
    const n2 = makeTerminalNode('term-2')
    mockNodes = [n1, n2, makeTextNode('text-1')]
    mockStatuses = [makeStatus('term-1', 'idle', 'demo'), makeStatus('term-2', 'busy', 'project')]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    const pills = screen.getAllByTestId('terminal-pill')
    expect(pills).toHaveLength(2)
  })

  it('collapsed state shows dot row and count label', () => {
    localStorage.setItem('te-terminal-dock-collapsed', 'true')

    const n1 = makeTerminalNode('term-1')
    const n2 = makeTerminalNode('term-2')
    mockNodes = [n1, n2]
    mockStatuses = [makeStatus('term-1', 'idle'), makeStatus('term-2', 'busy')]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    // Should NOT have pills
    expect(screen.queryAllByTestId('terminal-pill')).toHaveLength(0)

    // Should have collapsed dock
    const collapsed = screen.getByTestId('terminal-dock-collapsed')
    expect(collapsed).toBeTruthy()

    // Should show count
    expect(collapsed.textContent).toContain('2 terminals')

    // Should have dots
    const dots = screen.getAllByTestId('status-dot')
    expect(dots).toHaveLength(2)
  })

  it('error badge shows in collapsed state when errors > 0', () => {
    localStorage.setItem('te-terminal-dock-collapsed', 'true')

    const n1 = makeTerminalNode('term-1')
    const n2 = makeTerminalNode('term-2')
    mockNodes = [n1, n2]
    mockStatuses = [makeStatus('term-1', 'error'), makeStatus('term-2', 'idle')]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    const badge = screen.getByTestId('error-badge')
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('1')
  })

  it('toggle expand/collapse persists to localStorage', () => {
    const n1 = makeTerminalNode('term-1')
    mockNodes = [n1]
    mockStatuses = [makeStatus('term-1')]

    // Start expanded (default)
    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    // Should be expanded - find the collapse toggle button
    const collapseBtn = screen.getByTestId('dock-toggle')
    expect(collapseBtn).toBeTruthy()

    // Click to collapse
    fireEvent.click(collapseBtn)
    expect(localStorage.getItem('te-terminal-dock-collapsed')).toBe('true')

    // Click collapsed dock to expand
    const collapsed = screen.getByTestId('terminal-dock-collapsed')
    fireEvent.click(collapsed)
    expect(localStorage.getItem('te-terminal-dock-collapsed')).toBe('false')
  })

  it('mounts with te-card-enter class on the dock bar', () => {
    const n1 = makeTerminalNode('term-1')
    mockNodes = [n1]
    mockStatuses = [makeStatus('term-1')]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    const bar = screen.getByTestId('terminal-dock-bar')
    expect(bar.className).toContain('te-card-enter')
  })

  it('click pill calls setViewport with correct formula, setFocusedTerminal, and setSelection', () => {
    const n1 = makeTerminalNode('term-1', {}, { x: 500, y: 300 }, { width: 320, height: 240 })
    mockNodes = [n1]
    mockStatuses = [makeStatus('term-1')]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    const pill = screen.getByTestId('terminal-pill')
    fireEvent.click(pill)

    // cx = 500 + 320/2 = 660
    // cy = 300 + 240/2 = 420
    // zoom = 0.8
    // x = 1200/2 - 660 * 0.8 = 600 - 528 = 72
    // y = 800/2 - 420 * 0.8 = 400 - 336 = 64
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 72, y: 64, zoom: 0.8 })
    expect(mockSetFocusedTerminal).toHaveBeenCalledWith('term-1')
    expect(mockSetSelection).toHaveBeenCalledWith(new Set(['term-1']))
  })

  it('navigation is no-op when containerWidth is 0', () => {
    const n1 = makeTerminalNode('term-1')
    mockNodes = [n1]
    mockStatuses = [makeStatus('term-1')]

    render(<TerminalDock containerWidth={0} containerHeight={800} />)

    const pill = screen.getByTestId('terminal-pill')
    fireEvent.click(pill)

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockSetFocusedTerminal).not.toHaveBeenCalled()
    expect(mockSetSelection).not.toHaveBeenCalled()
  })

  it('navigation is no-op when containerHeight is 0', () => {
    const n1 = makeTerminalNode('term-1')
    mockNodes = [n1]
    mockStatuses = [makeStatus('term-1')]

    render(<TerminalDock containerWidth={1200} containerHeight={0} />)

    const pill = screen.getByTestId('terminal-pill')
    fireEvent.click(pill)

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockSetFocusedTerminal).not.toHaveBeenCalled()
    expect(mockSetSelection).not.toHaveBeenCalled()
  })

  it('shows correct dot colors for each status', () => {
    const n1 = makeTerminalNode('t-idle')
    const n2 = makeTerminalNode('t-busy')
    const n3 = makeTerminalNode('t-error')
    const n4 = makeTerminalNode('t-claude')
    const n5 = makeTerminalNode('t-dead')
    mockNodes = [n1, n2, n3, n4, n5]
    mockStatuses = [
      makeStatus('t-idle', 'idle'),
      makeStatus('t-busy', 'busy'),
      makeStatus('t-error', 'error'),
      makeStatus('t-claude', 'claude'),
      makeStatus('t-dead', 'dead')
    ]

    render(<TerminalDock containerWidth={1200} containerHeight={800} />)

    const dots = screen.getAllByTestId('status-dot')
    expect(dots).toHaveLength(5)

    // Verify dot background colors match spec
    expect(dots[0].style.backgroundColor).toBe('#3dca8d') // idle
    expect(dots[1].style.backgroundColor).toBe('#60a5fa') // busy
    expect(dots[2].style.backgroundColor).toBe('#ef4444') // error
    expect(dots[3].style.backgroundColor).toBe('#00e5bf') // claude
    // dead uses CSS variable, check it exists
    expect(dots[4].style.backgroundColor).toBeTruthy()
  })
})
