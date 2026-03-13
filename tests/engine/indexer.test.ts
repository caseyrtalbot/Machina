import { describe, it, expect } from 'vitest'
import { VaultIndex } from '@engine/indexer'

const FILES: Record<string, string> = {
  'g1.md': `---\nid: g1\ntitle: Gene One\ntype: gene\ncreated: 2026-03-12\nmodified: 2026-03-12\nconnections:\n  - g2\nclusters_with:\n  - g2\n---\nBody one`,
  'g2.md': `---\nid: g2\ntitle: Gene Two\ntype: gene\ncreated: 2026-03-12\nmodified: 2026-03-12\n---\nBody two`,
  'c1.md': `---\nid: c1\ntitle: Constraint\ntype: constraint\ncreated: 2026-03-12\nmodified: 2026-03-12\ntensions_with:\n  - g1\n---\nBody three`
}

describe('VaultIndex', () => {
  it('indexes files and builds graph', () => {
    const index = new VaultIndex()
    for (const [filename, content] of Object.entries(FILES)) {
      index.addFile(filename, content)
    }
    expect(index.getArtifacts()).toHaveLength(3)
    const graph = index.getGraph()
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it('updates on file change', () => {
    const index = new VaultIndex()
    index.addFile('g1.md', FILES['g1.md'])
    expect(index.getArtifact('g1')?.title).toBe('Gene One')

    const updated = FILES['g1.md'].replace('Gene One', 'Updated Gene')
    index.updateFile('g1.md', updated)
    expect(index.getArtifact('g1')?.title).toBe('Updated Gene')
  })

  it('removes on file delete', () => {
    const index = new VaultIndex()
    index.addFile('g1.md', FILES['g1.md'])
    expect(index.getArtifacts()).toHaveLength(1)
    index.removeFile('g1.md')
    expect(index.getArtifacts()).toHaveLength(0)
  })

  it('searches by title', () => {
    const index = new VaultIndex()
    for (const [f, c] of Object.entries(FILES)) index.addFile(f, c)
    const results = index.search('gene')
    expect(results).toHaveLength(2)
  })

  it('skips malformed files gracefully', () => {
    const index = new VaultIndex()
    index.addFile('bad.md', 'no frontmatter here')
    expect(index.getArtifacts()).toHaveLength(0)
    expect(index.getErrors()).toHaveLength(1)
  })
})
