import { describe, it, expect } from 'vitest'
import {
  buildGhostIndex,
  extractContext,
  inferFolder,
  isPathGhost,
  stripWikilinksFromContext
} from '../../src/renderer/src/engine/ghost-index'
import type { KnowledgeGraph, GraphNode, GraphEdge, Artifact } from '../../src/shared/types'

function makeNode(id: string, path?: string): GraphNode {
  return {
    id,
    title: id,
    type: 'note',
    signal: 'untested',
    connectionCount: 0,
    path
  }
}

function makeEdge(source: string, target: string, kind: GraphEdge['kind'] = 'related'): GraphEdge {
  return { source, target, kind }
}

function makeArtifact(overrides: Partial<Artifact> & { id: string; title: string }): Artifact {
  return {
    type: 'note',
    created: '2026-01-01',
    modified: '2026-01-01',
    signal: 'untested',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    concepts: [],
    bodyLinks: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

describe('isPathGhost', () => {
  it('returns true for path-based IDs', () => {
    expect(isPathGhost('Project Notes/Themes/Systems Thinking')).toBe(true)
    expect(isPathGhost('Reading List/Talks 1')).toBe(true)
  })

  it('returns false for simple idea references', () => {
    expect(isPathGhost('Richard Hamming')).toBe(false)
    expect(isPathGhost('leverage')).toBe(false)
    expect(isPathGhost('specific knowledge')).toBe(false)
  })
})

describe('stripWikilinksFromContext', () => {
  it('strips simple wikilinks keeping the target text', () => {
    expect(stripWikilinksFromContext('Author: [[Richard Hamming]]')).toBe('Author: Richard Hamming')
  })

  it('uses display alias when present', () => {
    expect(stripWikilinksFromContext('see [[Richard Hamming|Hamming]] for details')).toBe(
      'see Hamming for details'
    )
  })

  it('uses last path segment for path-style targets without alias', () => {
    expect(stripWikilinksFromContext('in [[Project Notes/Themes/Systems Thinking]] we find')).toBe(
      'in Systems Thinking we find'
    )
  })

  it('uses alias over path for path-style targets with alias', () => {
    expect(stripWikilinksFromContext('[[Project Notes/Themes/Clarity|Clarity]] is important')).toBe(
      'Clarity is important'
    )
  })

  it('handles multiple wikilinks in one string', () => {
    expect(stripWikilinksFromContext('[[A]] and [[B|bee]]')).toBe('A and bee')
  })

  it('returns text unchanged when no wikilinks', () => {
    expect(stripWikilinksFromContext('plain text')).toBe('plain text')
  })
})

describe('extractContext', () => {
  it('extracts surrounding text with wikilinks stripped', () => {
    const body = 'This is a long paragraph about how [[Richard Hamming]] gave a legendary talk.'
    const result = extractContext(body, 'Richard Hamming')
    expect(result).toContain('Richard Hamming')
    expect(result).toContain('legendary talk')
    // Wikilink brackets should be stripped
    expect(result).not.toContain('[[')
  })

  it('returns null when wikilink is not found', () => {
    const result = extractContext('No links here.', 'Missing')
    expect(result).toBeNull()
  })

  it('adds ellipsis when context is truncated', () => {
    const body = 'A'.repeat(60) + '[[Target]]' + 'B'.repeat(60)
    const result = extractContext(body, 'Target')
    expect(result).toMatch(/^\.\.\./)
    expect(result).toMatch(/\.\.\.$/)
  })

  it('strips alias wikilinks in context', () => {
    const body = 'See [[Richard Hamming|Hamming]] for details.'
    const result = extractContext(body, 'Richard Hamming')
    expect(result).toContain('Hamming')
    expect(result).not.toContain('[[')
  })

  it('handles special regex characters in target', () => {
    const body = 'This links to [[C++ (language)]] which is interesting.'
    const result = extractContext(body, 'C++ (language)')
    expect(result).toContain('C++ (language)')
  })

  it('replaces newlines with spaces in context', () => {
    const body = 'Line one\n[[Target]]\nLine three'
    const result = extractContext(body, 'Target')
    expect(result).not.toContain('\n')
    expect(result).toContain('Target')
  })
})

describe('buildGhostIndex', () => {
  it('identifies ghost nodes (nodes without paths)', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('essay-1', '/vault/essay.md'),
        makeNode('Richard Hamming') // ghost - no path
      ],
      edges: [makeEdge('essay-1', 'Richard Hamming')]
    }

    const artifacts = [
      makeArtifact({
        id: 'essay-1',
        title: 'You and Your Research',
        body: 'Author: [[Richard Hamming]]'
      })
    ]

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('Richard Hamming')
    expect(result[0].referenceCount).toBe(1)
    expect(result[0].references[0].fileTitle).toBe('You and Your Research')
    expect(result[0].references[0].context).toContain('Richard Hamming')
    // Context should have wikilinks stripped
    expect(result[0].references[0].context).not.toContain('[[')
  })

  it('filters out path-based ghost nodes', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('src', '/vault/src.md'),
        makeNode('Richard Hamming'), // idea ghost - should appear
        makeNode('Project Notes/Themes/Clarity') // path ghost - should be filtered
      ],
      edges: [makeEdge('src', 'Richard Hamming'), makeEdge('src', 'Project Notes/Themes/Clarity')]
    }

    const artifacts = [
      makeArtifact({
        id: 'src',
        title: 'Source',
        body: '[[Richard Hamming]] and [[Project Notes/Themes/Clarity]]'
      })
    ]

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('Richard Hamming')
  })

  it('returns empty array when no ghost nodes exist', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('a', '/vault/a.md')],
      edges: []
    }
    const result = buildGhostIndex(graph, [])
    expect(result).toEqual([])
  })

  it('sorts by reference count descending', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode('a', '/vault/a.md'),
        makeNode('b', '/vault/b.md'),
        makeNode('c', '/vault/c.md'),
        makeNode('ghost-few'), // 1 reference
        makeNode('ghost-many') // 3 references
      ],
      edges: [
        makeEdge('a', 'ghost-few'),
        makeEdge('a', 'ghost-many'),
        makeEdge('b', 'ghost-many'),
        makeEdge('c', 'ghost-many')
      ]
    }

    const artifacts = [
      makeArtifact({ id: 'a', title: 'A', body: '[[ghost-few]] and [[ghost-many]]' }),
      makeArtifact({ id: 'b', title: 'B', body: '[[ghost-many]]' }),
      makeArtifact({ id: 'c', title: 'C', body: '[[ghost-many]]' })
    ]

    const result = buildGhostIndex(graph, artifacts)

    expect(result[0].id).toBe('ghost-many')
    expect(result[0].referenceCount).toBe(3)
    expect(result[1].id).toBe('ghost-few')
    expect(result[1].referenceCount).toBe(1)
  })

  it('skips ghost nodes with zero references', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('orphan-ghost')],
      edges: []
    }
    const result = buildGhostIndex(graph, [])
    expect(result).toEqual([])
  })

  it('handles frontmatter-only references', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('src', '/vault/src.md'), makeNode('fm-ghost')],
      edges: [makeEdge('src', 'fm-ghost', 'connection')]
    }

    const artifacts = [
      makeArtifact({
        id: 'src',
        title: 'Source',
        body: 'No wikilinks here.',
        connections: ['fm-ghost']
      })
    ]

    const result = buildGhostIndex(graph, artifacts)

    expect(result).toHaveLength(1)
    expect(result[0].references[0].context).toContain('frontmatter')
  })

  it('handles multiple references from the same file', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode('src', '/vault/src.md'), makeNode('ghost')],
      edges: [makeEdge('src', 'ghost')]
    }

    const artifacts = [
      makeArtifact({
        id: 'src',
        title: 'Source',
        body: 'First [[ghost]] mention. Second [[ghost]] mention.'
      })
    ]

    const result = buildGhostIndex(graph, artifacts)

    // Deduplicated to one reference per source file
    expect(result[0].referenceCount).toBe(1)
  })
})

describe('inferFolder', () => {
  const vault = '/vault'

  it('returns vault root when no reference paths', () => {
    expect(inferFolder('ghost', [], vault)).toBe(vault)
  })

  it('returns majority folder when >50% match', () => {
    const paths = ['/vault/Authors/file1.md', '/vault/Authors/file2.md', '/vault/Books/file3.md']
    expect(inferFolder('ghost', paths, vault)).toBe('/vault/Authors')
  })

  it('returns vault root when no majority', () => {
    const paths = ['/vault/A/file1.md', '/vault/B/file2.md', '/vault/C/file3.md']
    expect(inferFolder('ghost', paths, vault)).toBe(vault)
  })

  it('returns vault root when all files are in root', () => {
    const paths = ['/vault/file1.md', '/vault/file2.md']
    expect(inferFolder('ghost', paths, vault)).toBe(vault)
  })

  it('handles single reference path', () => {
    const paths = ['/vault/Authors/hamming.md']
    expect(inferFolder('ghost', paths, vault)).toBe('/vault/Authors')
  })
})
