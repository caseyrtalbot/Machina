import { describe, it, expect } from 'vitest'
import { computeFolderMapLayout } from '../../src/renderer/src/panels/canvas/folder-map-layout'
import type { ProjectMapSnapshot } from '@shared/engine/project-map-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeSnapshot(overrides: Partial<ProjectMapSnapshot> = {}): ProjectMapSnapshot {
  return {
    rootPath: '/project',
    nodes: [],
    edges: [],
    truncated: false,
    totalFileCount: 0,
    skippedCount: 0,
    unresolvedRefs: [],
    ...overrides
  }
}

describe('computeFolderMapLayout', () => {
  it('returns empty result for empty snapshot', () => {
    const result = computeFolderMapLayout(makeSnapshot(), { x: 0, y: 0 }, [])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('positions root node at origin', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: [],
          childCount: 0
        }
      ]
    })
    const result = computeFolderMapLayout(snapshot, { x: 100, y: 200 }, [])
    expect(result.nodes.length).toBe(1)
    expect(result.nodes[0].position.x).toBe(100)
    expect(result.nodes[0].position.y).toBe(200)
  })

  it('places children below parent with levelGap spacing', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: ['child1'],
          childCount: 1
        },
        {
          id: 'child1',
          relativePath: 'app.ts',
          name: 'app.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 10,
          children: [],
          childCount: 0
        }
      ],
      edges: [{ source: 'root', target: 'child1', kind: 'contains' }]
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const child = result.nodes.find((n) => n.metadata.relativePath === 'app.ts')!
    expect(child.position.y).toBeGreaterThan(root.position.y)
  })

  it('centers parent over multiple children', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: ['c1', 'c2', 'c3'],
          childCount: 3
        },
        {
          id: 'c1',
          relativePath: 'a.ts',
          name: 'a.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 5,
          children: [],
          childCount: 0
        },
        {
          id: 'c2',
          relativePath: 'b.ts',
          name: 'b.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 5,
          children: [],
          childCount: 0
        },
        {
          id: 'c3',
          relativePath: 'c.ts',
          name: 'c.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 5,
          children: [],
          childCount: 0
        }
      ],
      edges: [
        { source: 'root', target: 'c1', kind: 'contains' },
        { source: 'root', target: 'c2', kind: 'contains' },
        { source: 'root', target: 'c3', kind: 'contains' }
      ]
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const root = result.nodes.find((n) => n.metadata.relativePath === '.')!
    const childXs = result.nodes
      .filter((n) => n.metadata.relativePath !== '.')
      .map((n) => n.position.x + n.size.width / 2)
    const childCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2
    const rootCenter = root.position.x + root.size.width / 2
    expect(Math.abs(rootCenter - childCenter)).toBeLessThan(10)
  })

  it('avoids collision with existing canvas nodes', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: [],
          childCount: 0
        }
      ]
    })
    const existing: CanvasNode[] = [
      {
        id: 'existing',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        content: 'test',
        metadata: {}
      }
    ]
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, existing)
    expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(500)
  })

  it('creates import edges with hidden flag', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: ['f1', 'f2'],
          childCount: 2
        },
        {
          id: 'f1',
          relativePath: 'a.ts',
          name: 'a.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 10,
          children: [],
          childCount: 0
        },
        {
          id: 'f2',
          relativePath: 'b.ts',
          name: 'b.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 10,
          children: [],
          childCount: 0
        }
      ],
      edges: [
        { source: 'root', target: 'f1', kind: 'contains' },
        { source: 'root', target: 'f2', kind: 'contains' },
        { source: 'f1', target: 'f2', kind: 'imports' }
      ]
    })
    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const importEdge = result.edges.find((e) => e.kind === 'imports')
    expect(importEdge).toBeDefined()
    expect(importEdge!.hidden).toBe(true)
  })

  it('uses note nodes and larger spacing for markdown files', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: ['note-1'],
          childCount: 1
        },
        {
          id: 'note-1',
          relativePath: 'docs/guide.md',
          name: 'guide.md',
          isDirectory: false,
          nodeType: 'note',
          depth: 1,
          lineCount: 24,
          children: [],
          childCount: 0
        }
      ],
      edges: [{ source: 'root', target: 'note-1', kind: 'contains' }]
    })

    const result = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const noteNode = result.nodes.find((node) => node.id === 'note-1')
    expect(noteNode?.type).toBe('note')
    expect(noteNode?.content).toBe('/project/docs/guide.md')
    expect(noteNode?.size.width).toBeGreaterThan(300)
    expect(noteNode?.size.height).toBeGreaterThan(220)
  })

  it('produces deterministic output', () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: 'root',
          relativePath: '.',
          name: 'project',
          isDirectory: true,
          nodeType: 'project-folder',
          depth: 0,
          lineCount: 0,
          children: ['c1', 'c2'],
          childCount: 2
        },
        {
          id: 'c1',
          relativePath: 'a.ts',
          name: 'a.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 5,
          children: [],
          childCount: 0
        },
        {
          id: 'c2',
          relativePath: 'b.ts',
          name: 'b.ts',
          isDirectory: false,
          nodeType: 'project-file',
          depth: 1,
          lineCount: 5,
          children: [],
          childCount: 0
        }
      ],
      edges: [
        { source: 'root', target: 'c1', kind: 'contains' },
        { source: 'root', target: 'c2', kind: 'contains' }
      ]
    })
    const r1 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    const r2 = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [])
    expect(r1.nodes.map((n) => n.position)).toEqual(r2.nodes.map((n) => n.position))
  })
})
