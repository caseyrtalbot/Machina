import { describe, it, expect } from 'vitest'
import {
  deriveCanvasFilePaths,
  deriveCanvasConnectionCounts
} from '../../src/renderer/src/hooks/useCanvasAwareness'
import type { CanvasNode } from '../../src/shared/canvas-types'
import type { GraphEdge } from '../../src/shared/types'

function makeNode(
  type: CanvasNode['type'],
  content: string,
  id = `n_${Math.random().toString(36).slice(2)}`
): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    content,
    metadata: {}
  }
}

describe('deriveCanvasFilePaths', () => {
  it('extracts paths from note-type nodes', () => {
    const nodes = [makeNode('note', '/vault/alpha.md'), makeNode('note', '/vault/beta.md')]
    const result = deriveCanvasFilePaths(nodes)
    expect(result).toEqual(new Set(['/vault/alpha.md', '/vault/beta.md']))
  })

  it('ignores non-note node types', () => {
    const nodes = [
      makeNode('text', 'some plain text'),
      makeNode('code', 'const x = 1'),
      makeNode('note', '/vault/alpha.md'),
      makeNode('terminal', ''),
      makeNode('markdown', '# Hello')
    ]
    const result = deriveCanvasFilePaths(nodes)
    expect(result).toEqual(new Set(['/vault/alpha.md']))
  })

  it('returns empty set for empty canvas', () => {
    expect(deriveCanvasFilePaths([])).toEqual(new Set())
  })

  it('deduplicates paths from multiple nodes referencing same file', () => {
    const nodes = [makeNode('note', '/vault/alpha.md'), makeNode('note', '/vault/alpha.md')]
    const result = deriveCanvasFilePaths(nodes)
    expect(result.size).toBe(1)
    expect(result.has('/vault/alpha.md')).toBe(true)
  })

  it('ignores note nodes with empty content', () => {
    const nodes = [makeNode('note', ''), makeNode('note', '/vault/real.md')]
    const result = deriveCanvasFilePaths(nodes)
    expect(result).toEqual(new Set(['/vault/real.md']))
  })
})

describe('deriveCanvasConnectionCounts', () => {
  const fileToId: Record<string, string> = {
    '/vault/a.md': 'id-a',
    '/vault/b.md': 'id-b',
    '/vault/c.md': 'id-c',
    '/vault/d.md': 'id-d'
  }

  it('counts bilateral connections between on-canvas files', () => {
    const onCanvas = new Set(['/vault/a.md', '/vault/b.md'])
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-b', kind: 'connection' }]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.get('/vault/a.md')).toBe(1)
    expect(counts.get('/vault/b.md')).toBe(1)
  })

  it('excludes edges where one end is off-canvas', () => {
    const onCanvas = new Set(['/vault/a.md'])
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-b', kind: 'connection' }]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.size).toBe(0)
  })

  it('returns empty map for no edges', () => {
    const onCanvas = new Set(['/vault/a.md', '/vault/b.md'])
    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, [])
    expect(counts.size).toBe(0)
  })

  it('returns empty map for empty canvas', () => {
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-b', kind: 'connection' }]
    const counts = deriveCanvasConnectionCounts(new Set(), fileToId, edges)
    expect(counts.size).toBe(0)
  })

  it('counts multiple connections correctly', () => {
    // a--b, a--c, b--c: a=2, b=2, c=2
    const onCanvas = new Set(['/vault/a.md', '/vault/b.md', '/vault/c.md'])
    const edges: GraphEdge[] = [
      { source: 'id-a', target: 'id-b', kind: 'connection' },
      { source: 'id-a', target: 'id-c', kind: 'cluster' },
      { source: 'id-b', target: 'id-c', kind: 'tension' }
    ]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.get('/vault/a.md')).toBe(2)
    expect(counts.get('/vault/b.md')).toBe(2)
    expect(counts.get('/vault/c.md')).toBe(2)
  })

  it('handles isolated on-canvas files (no graph edges at all)', () => {
    const onCanvas = new Set(['/vault/d.md'])
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-b', kind: 'connection' }]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.has('/vault/d.md')).toBe(false)
  })

  it('ignores files not in fileToId mapping', () => {
    const onCanvas = new Set(['/vault/unknown.md', '/vault/a.md'])
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-b', kind: 'connection' }]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.size).toBe(0)
  })

  it('skips self-links', () => {
    const onCanvas = new Set(['/vault/a.md'])
    const edges: GraphEdge[] = [{ source: 'id-a', target: 'id-a', kind: 'connection' }]

    const counts = deriveCanvasConnectionCounts(onCanvas, fileToId, edges)
    expect(counts.size).toBe(0)
  })
})
