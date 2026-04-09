import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../store/vault-store', () => ({
  useVaultStore: vi.fn((selector) => {
    const state = {
      artifacts: [{ id: 'a1', origin: 'source' }],
      graph: { edges: [] }
    }
    return selector(state)
  })
}))

vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: vi.fn((selector) => {
    const state = {
      selectedNodeIds: new Set<string>(),
      nodes: [{ id: 'n1' }]
    }
    return selector(state)
  })
}))

vi.mock('../../../design/tokens', () => ({
  colors: {
    text: { primary: '#fff', secondary: '#aaa', muted: '#555' },
    accent: { default: '#00f', hover: '#00e', muted: '#009' }
  },
  floatingPanel: {
    glass: {
      bg: 'rgba(4, 4, 8, 0.90)',
      blur: 'blur(24px) saturate(1.4)'
    }
  }
}))

import { CanvasActionBar } from '../CanvasActionBar'
import type { AgentActionName } from '@shared/agent-action-types'

describe('CanvasActionBar', () => {
  afterEach(cleanup)

  const baseProps = {
    onTriggerAction: vi.fn(),
    onStop: vi.fn(),
    activeAction: null as AgentActionName | null,
    phase: 'idle' as const,
    onClearCanvas: vi.fn()
  }

  it('renders the Clear button when canvas has nodes', () => {
    render(<CanvasActionBar {...baseProps} />)
    expect(screen.getByText('Clear')).toBeTruthy()
  })

  it('calls onClearCanvas when Clear button is clicked', () => {
    const onClearCanvas = vi.fn()
    render(<CanvasActionBar {...baseProps} onClearCanvas={onClearCanvas} />)
    fireEvent.click(screen.getByText('Clear'))
    expect(onClearCanvas).toHaveBeenCalledOnce()
  })

  it('does not call onClearCanvas when computing', () => {
    const onClearCanvas = vi.fn()
    render(
      <CanvasActionBar
        {...baseProps}
        onClearCanvas={onClearCanvas}
        phase="computing"
        activeAction="compile"
      />
    )
    fireEvent.click(screen.getByText('Clear'))
    expect(onClearCanvas).not.toHaveBeenCalled()
  })

  it('applies glass background style to container', () => {
    const { container } = render(<CanvasActionBar {...baseProps} />)
    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.style.backgroundColor).toBe('rgba(4, 4, 8, 0.90)')
  })

  it('renders divider between Compile and Clear', () => {
    const { container } = render(<CanvasActionBar {...baseProps} />)
    const dividers = container.querySelectorAll('div')
    const dividerElements = Array.from(dividers).filter(
      (el) => el.style.width === '1px' && el.style.height === '16px'
    )
    expect(dividerElements.length).toBeGreaterThanOrEqual(1)
  })
})
