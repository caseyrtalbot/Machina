import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '../canvas-store'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

const mockKill = vi.fn().mockResolvedValue(undefined)

;(window as unknown as Record<string, unknown>).api = {
  terminal: {
    kill: mockKill
  }
}

const makeNode = (id: string, type: CanvasNode['type'] = 'terminal', content = ''): CanvasNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  content,
  metadata: {}
})

const makeEdge = (id: string, from: string, to: string): CanvasEdge => ({
  id,
  fromNode: from,
  toNode: to,
  fromSide: 'right',
  toSide: 'left'
})

describe('canvas-store removeNode preserveSession', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    vi.clearAllMocks()
  })

  it('kills the PTY session by default when removing a terminal node with a session', () => {
    useCanvasStore.setState({
      nodes: [makeNode('term-1', 'terminal', 'sess-abc')],
      isDirty: false
    })

    useCanvasStore.getState().removeNode('term-1')

    expect(mockKill).toHaveBeenCalledTimes(1)
    expect(mockKill).toHaveBeenCalledWith('sess-abc')
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('does not kill the PTY with preserveSession but still removes the node and its edges', () => {
    useCanvasStore.setState({
      nodes: [makeNode('term-1', 'terminal', 'sess-abc'), makeNode('n2', 'text', 'hello')],
      edges: [makeEdge('e1', 'term-1', 'n2'), makeEdge('e2', 'n2', 'term-1')],
      isDirty: false
    })

    useCanvasStore.getState().removeNode('term-1', { preserveSession: true })

    expect(mockKill).not.toHaveBeenCalled()
    const { nodes, edges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n2')
    expect(edges).toHaveLength(0)
  })

  it('never kills a session when removing a non-terminal node', () => {
    useCanvasStore.setState({
      nodes: [makeNode('text-1', 'text', 'some content')],
      isDirty: false
    })

    useCanvasStore.getState().removeNode('text-1')

    expect(mockKill).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('does not kill when the terminal node has no session (empty content)', () => {
    useCanvasStore.setState({
      nodes: [makeNode('term-empty', 'terminal', '')],
      isDirty: false
    })

    useCanvasStore.getState().removeNode('term-empty')

    expect(mockKill).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('is safe to pass preserveSession for a terminal node with empty content', () => {
    useCanvasStore.setState({
      nodes: [makeNode('term-empty', 'terminal', '')],
      isDirty: false
    })

    useCanvasStore.getState().removeNode('term-empty', { preserveSession: true })

    expect(mockKill).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })
})
