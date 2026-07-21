import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { CanvasNode } from '@shared/canvas-types'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../../store/canvas-store'
import { CanvasStoreProvider } from '../canvas-store-context'

const mockSetSelection = vi.fn()
const mockToggleSelection = vi.fn()
const mockSetHoveredNode = vi.fn()
const mockSetFocusedCard = vi.fn()
const mockLockCard = vi.fn()
const mockUnlockCard = vi.fn()

let mockFocusedCardId: string | null = null
let mockLockedCardId: string | null = null

function seedCanvasStore(): void {
  const store = getCanvasStore(DEFAULT_CANVAS_ID)
  store.setState({
    ...store.getInitialState(),
    focusedCardId: mockFocusedCardId,
    lockedCardId: mockLockedCardId,
    setSelection: mockSetSelection,
    toggleSelection: mockToggleSelection,
    setHoveredNode: mockSetHoveredNode,
    setFocusedCard: mockSetFocusedCard,
    lockCard: mockLockCard,
    unlockCard: mockUnlockCard
  })
}

function renderCardShell(ui: ReactElement) {
  seedCanvasStore()
  return render(<CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>{ui}</CanvasStoreProvider>)
}

vi.mock('../use-canvas-drag', () => ({
  useNodeDrag: () => ({ onDragStart: vi.fn() }),
  useNodeResize: () => ({ onResizeStart: vi.fn() })
}))

vi.mock('../../design/Theme', () => ({
  useEnv: () => ({
    cardBlur: 0,
    cardTitleFontSize: 11
  })
}))

vi.mock('../ConnectionDragOverlay', () => ({
  startConnectionDrag: vi.fn(),
  endConnectionDrag: vi.fn(),
  isConnectionDragActive: () => false
}))

function makeTerminalNode(): CanvasNode {
  return {
    id: 'term-1',
    type: 'terminal',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 280 },
    content: '',
    metadata: {}
  }
}

describe('CardShell terminal activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFocusedCardId = null
    mockLockedCardId = null
  })

  it('invokes onActivateContentClick for an unfocused terminal content click', async () => {
    const { CardShell } = await import('../CardShell')
    const onActivateContentClick = vi.fn()

    const { container } = renderCardShell(
      <CardShell
        node={makeTerminalNode()}
        title="Terminal"
        onClose={vi.fn()}
        onActivateContentClick={onActivateContentClick}
      >
        <div>Terminal child</div>
      </CardShell>
    )

    const content = container.querySelector('[data-canvas-card-content]') as HTMLElement | null
    expect(content).toBeTruthy()

    fireEvent.click(content!)

    expect(mockSetSelection).toHaveBeenCalledWith(new Set(['term-1']))
    expect(mockSetFocusedCard).toHaveBeenCalledWith('term-1')
    expect(onActivateContentClick).toHaveBeenCalledTimes(1)
  })

  it('does not invoke onActivateContentClick for shift-click selection gestures', async () => {
    const { CardShell } = await import('../CardShell')
    const onActivateContentClick = vi.fn()

    const { container } = renderCardShell(
      <CardShell
        node={makeTerminalNode()}
        title="Terminal"
        onClose={vi.fn()}
        onActivateContentClick={onActivateContentClick}
      >
        <div>Terminal child</div>
      </CardShell>
    )

    const content = container.querySelector('[data-canvas-card-content]') as HTMLElement | null
    expect(content).toBeTruthy()

    fireEvent.click(content!, { shiftKey: true })

    expect(mockToggleSelection).toHaveBeenCalledWith('term-1')
    expect(onActivateContentClick).not.toHaveBeenCalled()
  })
})
