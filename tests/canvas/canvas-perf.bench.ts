import { describe, bench, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { useVaultStore } from '../../src/renderer/src/store/vault-store'
import { getLodLevel } from '../../src/renderer/src/panels/canvas/use-canvas-lod'
import type { CanvasNode } from '../../src/shared/canvas-types'
import type { Artifact, KnowledgeGraph, GraphEdge } from '../../src/shared/types'
import type { WorkerResult } from '../../src/shared/engine/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNodes(count: number): CanvasNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    type: 'text' as const,
    position: { x: i * 50, y: i * 30 },
    size: { width: 200, height: 150 },
    content: `Content for node ${i}`,
    metadata: {}
  }))
}

function makeArtifacts(count: number): Artifact[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `art-${i}`,
        title: `Artifact ${i}`,
        type: 'note' as const,
        path: `/art-${i}.md`,
        body: `Body of artifact ${i}`,
        bodyLinks: [],
        tags: i % 3 === 0 ? ['tag-a'] : [],
        connections: i % 4 === 0 ? [`art-${(i + 1) % count}`] : [],
        clusters_with: [],
        tensions_with: [],
        related: [],
        concepts: [],
        appears_in: [],
        frontmatter: {}
      }) as Artifact
  )
}

function makeEdges(count: number): GraphEdge[] {
  return Array.from({ length: count }, (_, i) => ({
    source: `art-${i}`,
    target: `art-${(i + 1) % (count + 1)}`,
    kind: 'connection' as const
  }))
}

// ---------------------------------------------------------------------------
// 1. canvas-store: moveNodes batch
// ---------------------------------------------------------------------------

describe('canvas-store: moveNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  for (const size of [25, 100, 500]) {
    const movedCount = Math.floor(size / 2)

    bench(
      `moveNodes - ${size} nodes (${movedCount} moved)`,
      () => {
        const updates = new Map<string, { x: number; y: number }>()
        for (let i = 0; i < movedCount; i++) {
          updates.set(`node-${i}`, { x: i * 60, y: i * 40 })
        }
        useCanvasStore.getState().moveNodes(updates)
      },
      {
        setup() {
          const nodes = makeNodes(size)
          useCanvasStore.setState({ nodes, isDirty: false })
        }
      }
    )
  }
})

// ---------------------------------------------------------------------------
// 2. EdgeLayer: nodeMap construction
// ---------------------------------------------------------------------------

describe('EdgeLayer: nodeMap construction', () => {
  for (const size of [25, 100, 500]) {
    const nodes = makeNodes(size)

    bench(`nodeMap from ${size} nodes`, () => {
      const m = new Map<string, CanvasNode>()
      for (const n of nodes) m.set(n.id, n)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. getLodLevel
// ---------------------------------------------------------------------------

describe('getLodLevel', () => {
  const zooms = [0.1, 0.2, 0.35, 0.55, 1.0]
  const types = ['text', 'note', 'markdown', 'code', undefined] as const

  bench('1000 calls across zoom levels and node types', () => {
    for (let i = 0; i < 1000; i++) {
      const zoom = zooms[i % zooms.length]
      const nodeType = types[i % types.length]
      getLodLevel(zoom, nodeType)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. vault-store: setWorkerResult with derived maps
// ---------------------------------------------------------------------------

describe('vault-store: setWorkerResult', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
  })

  for (const size of [50, 200, 1000]) {
    const edgeCount = Math.floor(size * 1.5)
    const artifacts = makeArtifacts(size)
    const edges = makeEdges(edgeCount)
    const graph: KnowledgeGraph = { nodes: [], edges }

    const result: WorkerResult = {
      artifacts,
      graph,
      errors: [],
      fileToId: Object.fromEntries(artifacts.map((a) => [a.path, a.id])),
      artifactPathById: Object.fromEntries(artifacts.map((a) => [a.id, a.path ?? '']))
    }

    bench(
      `setWorkerResult - ${size} artifacts, ${edgeCount} edges`,
      () => {
        useVaultStore.getState().setWorkerResult(result)
      },
      {
        setup() {
          useVaultStore.setState(useVaultStore.getInitialState())
        }
      }
    )
  }
})
