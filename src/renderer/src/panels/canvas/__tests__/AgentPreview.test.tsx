import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPreview } from '../AgentPreview'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

function makePlan(overrides: Partial<CanvasMutationPlan> = {}): CanvasMutationPlan {
  return {
    id: 'plan_test',
    operationId: 'op_test',
    source: 'agent',
    ops: [],
    summary: {
      addedNodes: 0,
      addedEdges: 0,
      movedNodes: 0,
      skippedFiles: 0,
      unresolvedRefs: 0
    },
    ...overrides
  }
}

const defaultProps = {
  phase: 'idle' as const,
  actionName: null,
  plan: null,
  errorMessage: null,
  errorTag: null,
  onApply: vi.fn(),
  onCancel: vi.fn()
}

describe('AgentPreview', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing when phase is idle', () => {
    const { container } = render(<AgentPreview {...defaultProps} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when phase is computing (AgentThoughtCard owns that phase)', () => {
    const { container } = render(
      <AgentPreview {...defaultProps} phase="computing" actionName="Suggest Connections" />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders error state with message', () => {
    render(<AgentPreview {...defaultProps} phase="error" errorMessage="LLM timeout" />)
    expect(screen.getByText('LLM timeout')).toBeTruthy()
    expect(screen.getByText('Dismiss')).toBeTruthy()
  })

  it('renders error state with fallback when errorMessage is null', () => {
    render(<AgentPreview {...defaultProps} phase="error" errorMessage={null} />)
    expect(screen.getByText('Agent action failed')).toBeTruthy()
  })

  it('calls onCancel when Dismiss is clicked in error state', () => {
    const onCancel = vi.fn()
    render(<AgentPreview {...defaultProps} phase="error" errorMessage="fail" onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders preview state with plan summary', () => {
    const plan = makePlan({
      summary: {
        addedNodes: 3,
        addedEdges: 2,
        movedNodes: 1,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    })
    render(
      <AgentPreview
        {...defaultProps}
        phase="preview"
        actionName="Suggest Connections"
        plan={plan}
      />
    )
    expect(screen.getByText('Suggest Connections')).toBeTruthy()
    expect(screen.getByText('3 new cards, 2 edges, 1 moved')).toBeTruthy()
    expect(screen.getByText('Apply')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('summarizes singular counts correctly', () => {
    const plan = makePlan({
      summary: {
        addedNodes: 1,
        addedEdges: 1,
        movedNodes: 0,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    })
    render(<AgentPreview {...defaultProps} phase="preview" actionName="Test" plan={plan} />)
    expect(screen.getByText('1 new card, 1 edge')).toBeTruthy()
  })

  it('summarizes remove ops from plan.ops', () => {
    const plan = makePlan({
      ops: [
        { type: 'remove-node', nodeId: 'n1' },
        { type: 'remove-node', nodeId: 'n2' },
        { type: 'remove-edge', edgeId: 'e1' }
      ]
    })
    render(<AgentPreview {...defaultProps} phase="preview" actionName="Cleanup" plan={plan} />)
    expect(screen.getByText('2 removed, 1 edge removed')).toBeTruthy()
  })

  it('shows "no changes" when plan has no ops or summary counts', () => {
    const plan = makePlan()
    render(<AgentPreview {...defaultProps} phase="preview" actionName="Empty" plan={plan} />)
    expect(screen.getByText('no changes')).toBeTruthy()
  })

  it('calls onApply when Apply button is clicked', () => {
    const onApply = vi.fn()
    const plan = makePlan({
      summary: { addedNodes: 1, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
    })
    render(
      <AgentPreview
        {...defaultProps}
        phase="preview"
        actionName="Test"
        plan={plan}
        onApply={onApply}
      />
    )
    fireEvent.click(screen.getByText('Apply'))
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn()
    const plan = makePlan({
      summary: { addedNodes: 1, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
    })
    render(
      <AgentPreview
        {...defaultProps}
        phase="preview"
        actionName="Test"
        plan={plan}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  describe('keyboard shortcuts', () => {
    it('calls onApply on Enter key in preview phase', () => {
      const onApply = vi.fn()
      const plan = makePlan({
        summary: { addedNodes: 1, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
      })
      render(
        <AgentPreview
          {...defaultProps}
          phase="preview"
          actionName="Test"
          plan={plan}
          onApply={onApply}
        />
      )
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onApply).toHaveBeenCalledOnce()
    })

    it('calls onCancel on Escape key in preview phase', () => {
      const onCancel = vi.fn()
      const plan = makePlan({
        summary: { addedNodes: 1, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
      })
      render(
        <AgentPreview
          {...defaultProps}
          phase="preview"
          actionName="Test"
          plan={plan}
          onCancel={onCancel}
        />
      )
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('calls onCancel on Escape key in error phase', () => {
      const onCancel = vi.fn()
      render(
        <AgentPreview {...defaultProps} phase="error" errorMessage="fail" onCancel={onCancel} />
      )
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('does not call onApply on Enter key in error phase', () => {
      const onApply = vi.fn()
      render(<AgentPreview {...defaultProps} phase="error" errorMessage="fail" onApply={onApply} />)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onApply).not.toHaveBeenCalled()
    })

    it('does not bind keyboard shortcuts in idle phase', () => {
      const onApply = vi.fn()
      const onCancel = vi.fn()
      render(<AgentPreview {...defaultProps} phase="idle" onApply={onApply} onCancel={onCancel} />)
      fireEvent.keyDown(window, { key: 'Enter' })
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onApply).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
