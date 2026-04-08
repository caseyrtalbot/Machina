import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { useVaultStore } from '../../src/renderer/src/store/vault-store'

// ---------------------------------------------------------------------------
// Mock window.api.agentAction (IPC bridge)
// ---------------------------------------------------------------------------
const mockCompute = vi.fn()
const mockCancel = vi.fn()

vi.stubGlobal('window', {
  ...window,
  api: {
    ...((window as Record<string, unknown>).api ?? {}),
    agentAction: {
      compute: mockCompute,
      cancel: mockCancel
    }
  }
})

// Import hook after mock is established
const { useAgentOrchestrator } = await import('../../src/renderer/src/hooks/use-agent-orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fakeCommandStack = { current: null }
const containerSize = { width: 1000, height: 800 }

describe('useAgentOrchestrator trigger', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    useVaultStore.setState(useVaultStore.getInitialState())
    mockCompute.mockReset()
    mockCancel.mockReset()
    // Default: resolve with a trivial plan
    mockCompute.mockResolvedValue({
      plan: {
        id: 'plan-1',
        operationId: 'op-1',
        source: 'agent',
        ops: [],
        summary: {
          addedNodes: 0,
          addedEdges: 0,
          movedNodes: 0,
          skippedFiles: 0,
          unresolvedRefs: 0
        }
      }
    })
  })

  it('forwards userPrompt to IPC when provided', async () => {
    const { result } = renderHook(() =>
      useAgentOrchestrator(fakeCommandStack as never, containerSize)
    )

    await act(async () => {
      await result.current.trigger('ask', 'What connects these ideas?')
    })

    expect(mockCompute).toHaveBeenCalledOnce()
    const arg = mockCompute.mock.calls[0][0]
    expect(arg.userPrompt).toBe('What connects these ideas?')
  })

  it('omits userPrompt when not provided', async () => {
    // Pre-seed canvas with a node and select it (so context extraction works)
    useCanvasStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'text' as const,
          position: { x: 0, y: 0 },
          size: { width: 240, height: 80 },
          content: 'hello',
          metadata: {}
        }
      ],
      selectedNodeIds: new Set(['n1'])
    })

    const { result } = renderHook(() =>
      useAgentOrchestrator(fakeCommandStack as never, containerSize)
    )

    await act(async () => {
      await result.current.trigger('challenge')
    })

    expect(mockCompute).toHaveBeenCalledOnce()
    const arg = mockCompute.mock.calls[0][0]
    expect(arg.userPrompt).toBeUndefined()
  })

  it('uses vault-scope context for ask with no selection', async () => {
    // No selected nodes -> vault scope for 'ask'
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      selectedNodeIds: new Set(),
      viewport: { x: 0, y: 0, zoom: 1 }
    })

    const { result } = renderHook(() =>
      useAgentOrchestrator(fakeCommandStack as never, containerSize)
    )

    await act(async () => {
      await result.current.trigger('ask', 'Summarize everything')
    })

    expect(mockCompute).toHaveBeenCalledOnce()
    const arg = mockCompute.mock.calls[0][0]
    // Vault-scope context sets vaultScope: true
    expect(arg.context.vaultScope).toBe(true)
    expect(arg.userPrompt).toBe('Summarize everything')
  })
})
