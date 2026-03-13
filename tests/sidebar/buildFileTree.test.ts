import { describe, it, expect } from 'vitest'
import { buildFileTree, type FlatTreeNode } from '../../src/renderer/src/panels/sidebar/buildFileTree'

describe('buildFileTree', () => {
  it('creates flat nodes from root-level files', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/alpha.md', '/vault/beta.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    expect(nodes).toHaveLength(2)
    expect(nodes[0].name).toBe('alpha.md')
    expect(nodes[0].isDirectory).toBe(false)
    expect(nodes[0].parentPath).toBe(vaultRoot)
    expect(nodes[1].name).toBe('beta.md')
    expect(nodes[1].isDirectory).toBe(false)
    expect(nodes[1].parentPath).toBe(vaultRoot)
  })

  it('creates directory nodes with parentPath references', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/notes/one.md', '/vault/notes/two.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    const dirNode = nodes.find((n) => n.isDirectory)
    expect(dirNode).toBeDefined()
    expect(dirNode!.name).toBe('notes')
    expect(dirNode!.parentPath).toBe(vaultRoot)
    expect(dirNode!.itemCount).toBe(2)

    const children = nodes.filter((n) => !n.isDirectory)
    expect(children).toHaveLength(2)
    expect(children[0].parentPath).toBe('/vault/notes')
    expect(children[1].parentPath).toBe('/vault/notes')
  })

  it('handles deeply nested paths with flat output', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/a/b/c/deep.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    // No node should have a children property
    for (const node of nodes) {
      expect((node as unknown as Record<string, unknown>)['children']).toBeUndefined()
    }

    const nodeA = nodes.find((n) => n.name === 'a')
    expect(nodeA).toBeDefined()
    expect(nodeA!.parentPath).toBe(vaultRoot)

    const nodeB = nodes.find((n) => n.name === 'b')
    expect(nodeB).toBeDefined()
    expect(nodeB!.parentPath).toBe('/vault/a')

    const nodeC = nodes.find((n) => n.name === 'c')
    expect(nodeC).toBeDefined()
    expect(nodeC!.parentPath).toBe('/vault/a/b')

    const nodeDeep = nodes.find((n) => n.name === 'deep.md')
    expect(nodeDeep).toBeDefined()
    expect(nodeDeep!.parentPath).toBe('/vault/a/b/c')
  })

  it('sorts directories before files at same parent', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/readme.md', '/vault/notes/one.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    const rootChildren = nodes.filter((n) => n.parentPath === vaultRoot)
    expect(rootChildren[0].isDirectory).toBe(true)
    expect(rootChildren[1].isDirectory).toBe(false)
  })

  it('includes item counts on directories', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/docs/a.md', '/vault/docs/b.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    const dirNode = nodes.find((n) => n.isDirectory && n.name === 'docs')
    expect(dirNode).toBeDefined()
    expect(dirNode!.itemCount).toBe(2)
  })

  it('computes depth from path segments', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/a/b/deep.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    const nodeA = nodes.find((n) => n.name === 'a')
    expect(nodeA!.depth).toBe(0)

    const nodeB = nodes.find((n) => n.name === 'b')
    expect(nodeB!.depth).toBe(1)

    const nodeDeep = nodes.find((n) => n.name === 'deep.md')
    expect(nodeDeep!.depth).toBe(2)
  })

  it('returns empty array for no files', () => {
    const nodes = buildFileTree([], '/vault')
    expect(nodes).toEqual([])
  })

  it('preserves alphabetical sort within parent groups', () => {
    const vaultRoot = '/vault'
    const filePaths = ['/vault/zebra.md', '/vault/apple.md', '/vault/mango.md']
    const nodes = buildFileTree(filePaths, vaultRoot)

    expect(nodes[0].name).toBe('apple.md')
    expect(nodes[1].name).toBe('mango.md')
    expect(nodes[2].name).toBe('zebra.md')
  })
})
