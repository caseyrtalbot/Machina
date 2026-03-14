import { describe, it, expect } from 'vitest'
import {
  createCanvasNode,
  createCanvasEdge,
  createCanvasFile,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasEdge,
  type CanvasSide,
  type CanvasFile
} from '../../src/shared/canvas-types'

describe('canvas-types', () => {
  describe('createCanvasNode', () => {
    it('creates a text node with defaults', () => {
      const node = createCanvasNode('text', { x: 100, y: 200 })
      expect(node.id).toBeTruthy()
      expect(node.type).toBe('text')
      expect(node.position).toEqual({ x: 100, y: 200 })
      expect(node.size.width).toBeGreaterThanOrEqual(200)
      expect(node.size.height).toBeGreaterThanOrEqual(100)
      expect(node.content).toBe('')
    })

    it('creates a terminal node with larger min size', () => {
      const node = createCanvasNode('terminal', { x: 0, y: 0 })
      expect(node.size.width).toBeGreaterThanOrEqual(300)
      expect(node.size.height).toBeGreaterThanOrEqual(200)
    })

    it('accepts custom size and content', () => {
      const node = createCanvasNode(
        'note',
        { x: 50, y: 50 },
        {
          size: { width: 400, height: 300 },
          content: '/path/to/note.md'
        }
      )
      expect(node.size).toEqual({ width: 400, height: 300 })
      expect(node.content).toBe('/path/to/note.md')
    })
  })

  describe('createCanvasEdge', () => {
    it('creates an edge between two nodes', () => {
      const edge = createCanvasEdge('node-a', 'node-b', 'right', 'left')
      expect(edge.id).toBeTruthy()
      expect(edge.fromNode).toBe('node-a')
      expect(edge.toNode).toBe('node-b')
      expect(edge.fromSide).toBe('right')
      expect(edge.toSide).toBe('left')
    })
  })

  describe('createCanvasFile', () => {
    it('creates an empty canvas file', () => {
      const file = createCanvasFile()
      expect(file.nodes).toEqual([])
      expect(file.edges).toEqual([])
      expect(file.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    })
  })
})
