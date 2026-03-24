import { describe, test, expect } from 'vitest'
import { buildTagIndex, filterArtifactsByTags } from '../../src/renderer/src/engine/tag-index'
import type { Artifact } from '../../src/shared/types'

function artifact(overrides: Partial<Artifact> & { id: string; tags: string[] }): Artifact {
  return {
    title: overrides.id,
    type: 'note',
    signal: 'untested',
    body: '',
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    bodyLinks: [],
    concepts: [],
    modified: '2026-01-01',
    frontmatter: {},
    ...overrides
  } as Artifact
}

describe('buildTagIndex', () => {
  test('builds flat tag tree', () => {
    const tree = buildTagIndex([
      artifact({ id: 'a', tags: ['react'] }),
      artifact({ id: 'b', tags: ['react'] }),
      artifact({ id: 'c', tags: ['vue'] })
    ])
    expect(tree).toHaveLength(2)
    const react = tree.find((t) => t.name === 'react')
    expect(react?.count).toBe(2)
    const vue = tree.find((t) => t.name === 'vue')
    expect(vue?.count).toBe(1)
  })

  test('builds hierarchical tree with aggregate counts', () => {
    const tree = buildTagIndex([
      artifact({ id: 'a', tags: ['dev/react'] }),
      artifact({ id: 'b', tags: ['dev/react'] }),
      artifact({ id: 'c', tags: ['dev/vue'] }),
      artifact({ id: 'd', tags: ['dev'] })
    ])
    expect(tree).toHaveLength(1)
    const dev = tree[0]
    expect(dev.name).toBe('dev')
    expect(dev.count).toBe(4) // 1 direct + 3 from children
    expect(dev.children).toHaveLength(2)
    const react = dev.children.find((c) => c.name === 'react')
    expect(react?.count).toBe(2)
  })

  test('strips leading # from tags', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: ['#react'] })])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('react')
  })

  test('handles empty tags gracefully', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: ['', ' ', '#'] })])
    expect(tree).toHaveLength(0)
  })

  test('handles artifacts with no tags', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: [] })])
    expect(tree).toHaveLength(0)
  })

  test('sorts children alphabetically', () => {
    const tree = buildTagIndex([
      artifact({ id: 'a', tags: ['zebra'] }),
      artifact({ id: 'b', tags: ['alpha'] }),
      artifact({ id: 'c', tags: ['middle'] })
    ])
    expect(tree.map((t) => t.name)).toEqual(['alpha', 'middle', 'zebra'])
  })

  test('deep hierarchy with 3 levels', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: ['a/b/c'] })])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('a')
    expect(tree[0].children[0].name).toBe('b')
    expect(tree[0].children[0].children[0].name).toBe('c')
    expect(tree[0].count).toBe(1) // bubbles up
  })

  test('fullPath tracks the complete tag path', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: ['dev/react/hooks'] })])
    expect(tree[0].fullPath).toBe('dev')
    expect(tree[0].children[0].fullPath).toBe('dev/react')
    expect(tree[0].children[0].children[0].fullPath).toBe('dev/react/hooks')
  })

  test('duplicate tags on same artifact are counted once per tag', () => {
    const tree = buildTagIndex([artifact({ id: 'a', tags: ['react', 'react'] })])
    expect(tree[0].count).toBe(2) // each tag occurrence counts
  })
})

describe('filterArtifactsByTags', () => {
  const arts = [
    artifact({ id: 'a', tags: ['react', 'hooks'] }),
    artifact({ id: 'b', tags: ['vue', 'composition'] }),
    artifact({ id: 'c', tags: ['react', 'testing'] }),
    artifact({ id: 'd', tags: ['dev/react'] })
  ]

  test('OR filter returns any matching tag', () => {
    const result = filterArtifactsByTags(arts, ['react'], 'or')
    expect(result.map((a) => a.id)).toEqual(['a', 'c'])
  })

  test('AND filter requires all selected tags', () => {
    const result = filterArtifactsByTags(arts, ['react', 'hooks'], 'and')
    expect(result.map((a) => a.id)).toEqual(['a'])
  })

  test('hierarchical match: selecting "dev" matches "dev/react"', () => {
    const result = filterArtifactsByTags(arts, ['dev'], 'or')
    expect(result.map((a) => a.id)).toEqual(['d'])
  })

  test('empty selectedTags returns all artifacts', () => {
    const result = filterArtifactsByTags(arts, [], 'or')
    expect(result).toHaveLength(4)
  })
})
