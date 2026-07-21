import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

describe('canvas-store', () => {
  beforeEach(() => {
    store.setState(store.getInitialState())
  })

  it('starts with null canvas', () => {
    const state = store.getState()
    expect(state.filePath).toBeNull()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
  })

  describe('node operations', () => {
    it('adds a node', () => {
      const node = createCanvasNode('text', { x: 100, y: 200 })
      store.getState().addNode(node)
      expect(store.getState().nodes).toHaveLength(1)
      expect(store.getState().nodes[0].id).toBe(node.id)
    })

    it('removes a node and its connected edges', () => {
      const n1 = createCanvasNode('text', { x: 0, y: 0 })
      const n2 = createCanvasNode('text', { x: 200, y: 0 })
      const edge = createCanvasEdge(n1.id, n2.id, 'right', 'left')
      const s = store.getState()
      s.addNode(n1)
      s.addNode(n2)
      s.addEdge(edge)

      store.getState().removeNode(n1.id)
      const after = store.getState()
      expect(after.nodes).toHaveLength(1)
      expect(after.edges).toHaveLength(0)
    })

    it('moves a node', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)
      store.getState().moveNode(node.id, { x: 50, y: 75 })
      expect(store.getState().nodes[0].position).toEqual({ x: 50, y: 75 })
    })

    it('resizes a node', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)
      store.getState().resizeNode(node.id, { width: 500, height: 300 })
      expect(store.getState().nodes[0].size).toEqual({ width: 500, height: 300 })
    })

    it('updates node content', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)
      store.getState().updateNodeContent(node.id, '# Hello')
      expect(store.getState().nodes[0].content).toBe('# Hello')
    })

    it('updates node metadata', () => {
      const node = createCanvasNode('code', { x: 0, y: 0 })
      store.getState().addNode(node)
      expect(store.getState().nodes[0].metadata).toEqual({ language: 'typescript' })

      store.getState().updateNodeMetadata(node.id, { language: 'python' })
      expect(store.getState().nodes[0].metadata).toEqual({ language: 'python' })
      expect(store.getState().isDirty).toBe(true)
    })

    it('merges metadata without overwriting other keys', () => {
      const node = createCanvasNode(
        'code',
        { x: 0, y: 0 },
        {
          metadata: { language: 'typescript', filename: 'main.ts' }
        }
      )
      store.getState().addNode(node)

      store.getState().updateNodeMetadata(node.id, { language: 'javascript' })
      const meta = store.getState().nodes[0].metadata
      expect(meta).toEqual({ language: 'javascript', filename: 'main.ts' })
    })

    it('resets metadata when changing node type', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)

      store.getState().updateNodeType(node.id, 'code')
      const updated = store.getState().nodes[0]
      expect(updated.type).toBe('code')
      expect(updated.content).toBe('')
      expect(updated.metadata).toEqual({ language: 'typescript' })
    })

    it('sets correct metadata when converting to markdown', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)

      store.getState().updateNodeType(node.id, 'markdown')
      expect(store.getState().nodes[0].metadata).toEqual({ viewMode: 'rendered' })
    })

    it('sets correct metadata when converting to image', () => {
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)

      store.getState().updateNodeType(node.id, 'image')
      expect(store.getState().nodes[0].metadata).toEqual({ src: '', alt: '' })
    })
  })

  describe('edge operations', () => {
    it('adds an edge', () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      store.getState().addEdge(edge)
      expect(store.getState().edges).toHaveLength(1)
    })

    it('removes an edge', () => {
      const edge = createCanvasEdge('a', 'b', 'right', 'left')
      store.getState().addEdge(edge)
      store.getState().removeEdge(edge.id)
      expect(store.getState().edges).toHaveLength(0)
    })
  })

  describe('selection', () => {
    it('selects and deselects nodes', () => {
      store.getState().setSelection(new Set(['a', 'b']))
      expect(store.getState().selectedNodeIds).toEqual(new Set(['a', 'b']))

      store.getState().clearSelection()
      expect(store.getState().selectedNodeIds.size).toBe(0)
    })
  })

  describe('viewport', () => {
    it('updates viewport', () => {
      store.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
      expect(store.getState().viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
    })
  })

  describe('dirty tracking', () => {
    it('marks dirty on mutation', () => {
      expect(store.getState().isDirty).toBe(false)
      const node = createCanvasNode('text', { x: 0, y: 0 })
      store.getState().addNode(node)
      expect(store.getState().isDirty).toBe(true)
    })
  })
})
