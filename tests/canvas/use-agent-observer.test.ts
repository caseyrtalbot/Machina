import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { AgentSidecarState } from '../../src/shared/agent-types'
import type { CanvasNode } from '../../src/shared/canvas-types'

// --- Mock useAgentStates ---
let currentAgentStates: readonly AgentSidecarState[] = []
vi.mock('../../src/renderer/src/hooks/use-agent-states', () => ({
  useAgentStates: () => currentAgentStates
}))

// --- Mock canvas store ---
const mockAddNode = vi.fn()
const mockUpdateNodeMetadata = vi.fn()
let mockNodes: readonly CanvasNode[] = []
let mockViewport = { x: 0, y: 0, zoom: 1 }

vi.mock('../../src/renderer/src/store/canvas-store', () => ({
  useCanvasStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        nodes: mockNodes,
        viewport: mockViewport,
        addNode: mockAddNode,
        updateNodeMetadata: mockUpdateNodeMetadata
      }),
    {
      getState: () => ({
        nodes: mockNodes,
        viewport: mockViewport,
        addNode: mockAddNode,
        updateNodeMetadata: mockUpdateNodeMetadata
      })
    }
  )
}))

const { useAgentObserver } = await import('../../src/renderer/src/hooks/use-agent-observer')

function makeAgentState(overrides?: Partial<AgentSidecarState>): AgentSidecarState {
  return {
    sessionId: 'session-1',
    tmuxName: 'te-abc123',
    status: 'alive',
    ...overrides
  }
}

function makeAgentNode(sessionId: string, extraMeta?: Record<string, unknown>): CanvasNode {
  return {
    id: `card-${sessionId}`,
    type: 'agent-session',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
    content: '',
    metadata: {
      sessionId,
      status: 'active',
      filesTouched: [],
      startedAt: 0,
      lastActivity: 0,
      ...extraMeta
    }
  }
}

describe('useAgentObserver', () => {
  beforeEach(() => {
    currentAgentStates = []
    mockNodes = []
    mockViewport = { x: 0, y: 0, zoom: 1 }
    mockAddNode.mockReset()
    mockUpdateNodeMetadata.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('creates a card for a new agent session', () => {
    currentAgentStates = [makeAgentState({ sessionId: 'new-agent-1' })]

    renderHook(() => useAgentObserver())

    expect(mockAddNode).toHaveBeenCalledOnce()
    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.type).toBe('agent-session')
    expect(addedNode.metadata.sessionId).toBe('new-agent-1')
  })

  it('does not create duplicate cards for known sessions', () => {
    mockNodes = [makeAgentNode('existing-session')]
    currentAgentStates = [makeAgentState({ sessionId: 'existing-session' })]

    renderHook(() => useAgentObserver())

    expect(mockAddNode).not.toHaveBeenCalled()
  })

  it('updates metadata on existing cards when state changes', () => {
    mockNodes = [makeAgentNode('session-x')]
    currentAgentStates = [
      makeAgentState({
        sessionId: 'session-x',
        status: 'exited',
        currentCommand: 'node',
        cwd: '/home/user/project'
      })
    ]

    renderHook(() => useAgentObserver())

    expect(mockUpdateNodeMetadata).toHaveBeenCalledWith(
      'card-session-x',
      expect.objectContaining({
        sessionId: 'session-x',
        status: 'completed',
        currentCommand: 'node',
        cwd: '/home/user/project'
      })
    )
  })

  it('maps alive status to active', () => {
    currentAgentStates = [makeAgentState({ sessionId: 'alive-sess', status: 'alive' })]

    renderHook(() => useAgentObserver())

    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.metadata.status).toBe('active')
  })

  it('maps exited status to completed', () => {
    currentAgentStates = [makeAgentState({ sessionId: 'exited-sess', status: 'exited' })]

    renderHook(() => useAgentObserver())

    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.metadata.status).toBe('completed')
  })

  it('maps idle status to idle', () => {
    currentAgentStates = [makeAgentState({ sessionId: 'idle-sess', status: 'idle' })]

    renderHook(() => useAgentObserver())

    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.metadata.status).toBe('idle')
  })

  it('includes sidecar data in card metadata when available', () => {
    currentAgentStates = [
      makeAgentState({
        sessionId: 'sidecar-sess',
        sidecar: {
          filesTouched: ['/src/a.ts', '/src/b.ts'],
          currentTask: 'Implementing feature X',
          agentType: 'claude-code'
        }
      })
    ]

    renderHook(() => useAgentObserver())

    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.metadata.filesTouched).toEqual(['/src/a.ts', '/src/b.ts'])
    expect(addedNode.metadata.currentTask).toBe('Implementing feature X')
    expect(addedNode.metadata.agentType).toBe('claude-code')
  })

  it('places new card at viewport center', () => {
    currentAgentStates = [makeAgentState({ sessionId: 'center-agent' })]

    renderHook(() => useAgentObserver())

    expect(mockAddNode).toHaveBeenCalledOnce()
    const addedNode = mockAddNode.mock.calls[0][0] as CanvasNode
    expect(addedNode.position).toBeDefined()
  })
})
