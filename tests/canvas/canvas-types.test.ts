import { describe, it, expect } from 'vitest'
import {
  createCanvasNode,
  createCanvasEdge,
  createCanvasFile,
  getMinSize,
  getDefaultSize,
  getDefaultMetadata,
  CARD_TYPE_INFO,
  type CanvasNodeType
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

    it('creates a code node with language metadata', () => {
      const node = createCanvasNode('code', { x: 0, y: 0 })
      expect(node.type).toBe('code')
      expect(node.metadata).toEqual({ language: 'typescript' })
      expect(node.size.width).toBeGreaterThanOrEqual(300)
      expect(node.size.height).toBeGreaterThanOrEqual(200)
    })

    it('creates a markdown node with viewMode metadata', () => {
      const node = createCanvasNode('markdown', { x: 0, y: 0 })
      expect(node.type).toBe('markdown')
      expect(node.metadata).toEqual({ viewMode: 'rendered' })
      expect(node.size.width).toBeGreaterThanOrEqual(250)
      expect(node.size.height).toBeGreaterThanOrEqual(150)
    })

    it('creates an image node with src metadata', () => {
      const node = createCanvasNode('image', { x: 0, y: 0 })
      expect(node.type).toBe('image')
      expect(node.metadata).toEqual({ src: '', alt: '' })
      expect(node.size.width).toBeGreaterThanOrEqual(150)
      expect(node.size.height).toBeGreaterThanOrEqual(150)
    })

    it('allows overriding metadata for code nodes', () => {
      const node = createCanvasNode('code', { x: 0, y: 0 }, {
        metadata: { language: 'python', filename: 'script.py' }
      })
      expect(node.metadata).toEqual({ language: 'python', filename: 'script.py' })
    })

    it('allows overriding metadata for image nodes', () => {
      const node = createCanvasNode('image', { x: 0, y: 0 }, {
        metadata: { src: '/path/to/img.png', alt: 'Screenshot' }
      })
      expect(node.metadata).toEqual({ src: '/path/to/img.png', alt: 'Screenshot' })
    })
  })

  describe('getMinSize', () => {
    it('returns min sizes for all node types', () => {
      const types: CanvasNodeType[] = ['text', 'note', 'terminal', 'code', 'markdown', 'image']
      for (const type of types) {
        const size = getMinSize(type)
        expect(size.width).toBeGreaterThan(0)
        expect(size.height).toBeGreaterThan(0)
      }
    })

    it('code has min 300x200', () => {
      expect(getMinSize('code')).toEqual({ width: 300, height: 200 })
    })

    it('markdown has min 250x150', () => {
      expect(getMinSize('markdown')).toEqual({ width: 250, height: 150 })
    })

    it('image has min 150x150', () => {
      expect(getMinSize('image')).toEqual({ width: 150, height: 150 })
    })
  })

  describe('getDefaultSize', () => {
    it('returns default sizes for all types', () => {
      const types: CanvasNodeType[] = ['text', 'note', 'terminal', 'code', 'markdown', 'image']
      for (const type of types) {
        const defSize = getDefaultSize(type)
        const minSize = getMinSize(type)
        expect(defSize.width).toBeGreaterThanOrEqual(minSize.width)
        expect(defSize.height).toBeGreaterThanOrEqual(minSize.height)
      }
    })
  })

  describe('getDefaultMetadata', () => {
    it('returns language for code type', () => {
      expect(getDefaultMetadata('code')).toEqual({ language: 'typescript' })
    })

    it('returns viewMode for markdown type', () => {
      expect(getDefaultMetadata('markdown')).toEqual({ viewMode: 'rendered' })
    })

    it('returns src/alt for image type', () => {
      expect(getDefaultMetadata('image')).toEqual({ src: '', alt: '' })
    })

    it('returns empty object for text, note, terminal', () => {
      expect(getDefaultMetadata('text')).toEqual({})
      expect(getDefaultMetadata('note')).toEqual({})
      expect(getDefaultMetadata('terminal')).toEqual({})
    })
  })

  describe('CARD_TYPE_INFO', () => {
    it('has entries for all six types', () => {
      const types: CanvasNodeType[] = ['text', 'note', 'terminal', 'code', 'markdown', 'image']
      for (const type of types) {
        expect(CARD_TYPE_INFO[type]).toBeDefined()
        expect(CARD_TYPE_INFO[type].label).toBeTruthy()
        expect(CARD_TYPE_INFO[type].icon).toBeTruthy()
        expect(['content', 'media', 'tools']).toContain(CARD_TYPE_INFO[type].category)
      }
    })

    it('groups content types correctly', () => {
      expect(CARD_TYPE_INFO.text.category).toBe('content')
      expect(CARD_TYPE_INFO.code.category).toBe('content')
      expect(CARD_TYPE_INFO.markdown.category).toBe('content')
      expect(CARD_TYPE_INFO.note.category).toBe('content')
    })

    it('groups media types correctly', () => {
      expect(CARD_TYPE_INFO.image.category).toBe('media')
    })

    it('groups tool types correctly', () => {
      expect(CARD_TYPE_INFO.terminal.category).toBe('tools')
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
