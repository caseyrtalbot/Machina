import { describe, it, expect } from 'vitest'
import { getCanvasNodeTitle } from '../../src/renderer/src/panels/canvas/card-title'
import type { CanvasNode } from '../../src/shared/canvas-types'
import type { Artifact } from '../../src/shared/types'

function makeNode(overrides: Partial<CanvasNode> & { type: CanvasNode['type'] }): CanvasNode {
  return {
    id: 'test-node',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    content: '',
    metadata: {},
    ...overrides
  }
}

describe('getCanvasNodeTitle', () => {
  describe('note type', () => {
    it('resolves title from artifacts when available', () => {
      const node = makeNode({ type: 'note', content: '/vault/my-note.md' })
      const artifacts = [{ id: 'a1', title: 'My Cool Note' } as Artifact]
      const fileToId: Record<string, string> = { '/vault/my-note.md': 'a1' }

      expect(getCanvasNodeTitle(node, artifacts, fileToId)).toBe('My Cool Note')
    })

    it('falls back to filename when artifact not found', () => {
      const node = makeNode({ type: 'note', content: '/vault/folder/deep-thought.md' })
      const artifacts: Artifact[] = []
      const fileToId: Record<string, string> = {}

      expect(getCanvasNodeTitle(node, artifacts, fileToId)).toBe('deep-thought')
    })

    it('falls back to filename when no artifacts provided', () => {
      const node = makeNode({ type: 'note', content: '/vault/something.md' })

      expect(getCanvasNodeTitle(node)).toBe('something')
    })

    it('returns Note when content is empty', () => {
      const node = makeNode({ type: 'note', content: '' })

      expect(getCanvasNodeTitle(node)).toBe('Note')
    })
  })

  describe('terminal type', () => {
    it('shows Claude Live for claude terminal', () => {
      const node = makeNode({
        type: 'terminal',
        metadata: { initialCommand: 'claude' }
      })

      expect(getCanvasNodeTitle(node)).toBe('Claude Live')
    })

    it('shows Terminal for regular terminal', () => {
      const node = makeNode({ type: 'terminal' })

      expect(getCanvasNodeTitle(node)).toBe('Terminal')
    })
  })

  describe('text type', () => {
    it('uses first line truncated to 30 chars', () => {
      const longContent =
        'This is a very long first line that exceeds thirty characters\nSecond line'
      const node = makeNode({ type: 'text', content: longContent })

      const title = getCanvasNodeTitle(node)
      expect(title.length).toBeLessThanOrEqual(30)
      expect(title).toBe('This is a very long first line')
    })

    it('returns Text for empty content', () => {
      const node = makeNode({ type: 'text', content: '' })
      expect(getCanvasNodeTitle(node)).toBe('Text')
    })
  })

  describe('code type', () => {
    it('uses filename from metadata', () => {
      const node = makeNode({
        type: 'code',
        metadata: { filename: 'index.ts', language: 'typescript' }
      })
      expect(getCanvasNodeTitle(node)).toBe('index.ts')
    })

    it('returns Code when no filename', () => {
      const node = makeNode({ type: 'code' })
      expect(getCanvasNodeTitle(node)).toBe('Code')
    })
  })

  describe('markdown type', () => {
    it('strips heading prefix and truncates', () => {
      const node = makeNode({ type: 'markdown', content: '## My Heading\nSome body text' })
      expect(getCanvasNodeTitle(node)).toBe('My Heading')
    })
  })

  describe('unknown type', () => {
    it('capitalizes the type name', () => {
      // Force an unknown type for testing
      const node = makeNode({ type: 'widget' as CanvasNode['type'] })
      expect(getCanvasNodeTitle(node)).toBe('Widget')
    })
  })
})
