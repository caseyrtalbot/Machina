import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'

describe('canvas-store', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('starts with null canvas', () => {
    const state = useCanvasStore.getState()
    expect(state.filePath).toBeNull()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
  })

  describe('node operations', () => {
    it('adds a node', () => {
      const node = createCanvasNode('text', { x: 100, y: 200 })
      useCanvasStore.getState().addNode(node)
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().nodes[0].id).toBe(node.id)
    })

    it('removes a node and its connected edges', () => {
      const n1 = createCanvasNode('text', { x: 0, y: 0 })
      const n2 = createCanvasNode('text', { x: 200, y: 0 })
      const edge = createCanvasEdge(n1.id, n2.id, 'right', 'left')
      const store = useCanvasStore.getState()
      store.addNode(n1)
      store.addNode(n2)
      store.addEdge(edge)

      useCanvasStore.getState().removeNode(n1.id)
      const after = useCanvasStore.getState()
      expect(after.nodes).toHaveLength(1)
      expect(after.edges).toHaveLength(0)
    })

    it('moves a node', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(node)
      useCanvasStore.getState().moveNode(node.id, { x: 50, y: 75 })
      expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 50, y: 75 })
    })

    it('resizes a node', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(node)
      useCanvasStore.getState().resizeNode(node.id, { width: 500, height: 300 })
      expect(useCanvasStore.getState().nodes[0].size).toEqual({ width: 500, height: 300 })
    })

    it('updates node content', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(node)
      useCanvasStore.getState().updateNodeContent(node.id, '# Hello')
      expect(useCanvasStore.getState().nodes[0].content).toBe('# Hello')
    })
  })

  describe('edge operations', () => {
    it('adds an edge', () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      useCanvasStore.getState().addEdge(edge)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })

    it('removes an edge', () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      useCanvasStore.getState().addEdge(edge)
      useCanvasStore.getState().removeEdge(edge.id)
      expect(useCanvasStore.getState().edges).toHaveLength(0)
    })
  })

  describe('selection', () => {
    it('selects and deselects nodes', () => {
      useCanvasStore.getState().setSelection(new Set(['a', 'b']))
      expect(useCanvasStore.getState().selectedNodeIds).toEqual(new Set(['a', 'b']))

      useCanvasStore.getState().clearSelection()
      expect(useCanvasStore.getState().selectedNodeIds.size).toBe(0)
    })
  })

  describe('viewport', () => {
    it('updates viewport', () => {
      useCanvasStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
      expect(useCanvasStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
    })
  })

  describe('dirty tracking', () => {
    it('marks dirty on mutation', () => {
      expect(useCanvasStore.getState().isDirty).toBe(false)
      const node = createCanvasNode('text', { x: 0, y: 0 })
      useCanvasStore.getState().addNode(node)
      expect(useCanvasStore.getState().isDirty).toBe(true)
    })
  })
})
