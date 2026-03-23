import { describe, expect, it, beforeEach, vi } from 'vitest'
import { TE_DIR } from '@shared/constants'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'
import { serializeCanvas } from '../canvas/canvas-io'
import { restorePatternSnapshot } from './workbench-artifact-placement'

const SNAPSHOT_CANVAS = {
  nodes: [
    createCanvasNode('terminal', { x: 0, y: 0 }, { content: 'npm test' }),
    createCanvasNode(
      'project-file',
      { x: 300, y: 0 },
      {
        content: 'src/app.tsx',
        metadata: {
          relativePath: 'src/app.tsx',
          language: 'typescriptreact',
          touchCount: 3,
          lastTouchedBy: null
        }
      }
    )
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
}

function createMockFsReader(files: Record<string, string>): (path: string) => Promise<string> {
  return vi.fn(async (path: string) => {
    const content = files[path]
    if (!content) throw new Error(`Not found: ${path}`)
    return content
  })
}

describe('restorePatternSnapshot', () => {
  beforeEach(() => {
    useCanvasStore.getState().closeCanvas()
  })

  it('merges snapshot nodes into the current canvas', async () => {
    // Pre-existing node on canvas
    const existing = createCanvasNode('text', { x: -200, y: 0 }, { content: 'my note' })
    useCanvasStore.getState().addNode(existing)

    const snapshotPath = `${TE_DIR}/artifacts/patterns/p-test.canvas.json`
    const absolutePath = '/vault/' + snapshotPath
    const reader = createMockFsReader({ [absolutePath]: serializeCanvas(SNAPSHOT_CANVAS) })

    await restorePatternSnapshot(snapshotPath, '/vault', reader)

    const nodes = useCanvasStore.getState().nodes
    // Existing node + 2 from snapshot
    expect(nodes).toHaveLength(3)
    expect(nodes[0].content).toBe('my note')
    expect(nodes.some((n) => n.content === 'npm test')).toBe(true)
    expect(nodes.some((n) => n.content === 'src/app.tsx')).toBe(true)
  })

  it('does nothing when snapshot file is missing', async () => {
    const reader = createMockFsReader({})

    await restorePatternSnapshot('missing.canvas.json', '/vault', reader)

    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('does nothing when snapshot path is empty', async () => {
    const reader = vi.fn()

    await restorePatternSnapshot('', '/vault', reader)

    expect(reader).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('deduplicates nodes when restoring the same snapshot twice', async () => {
    const snapshotPath = `${TE_DIR}/artifacts/patterns/p-test.canvas.json`
    const absolutePath = '/vault/' + snapshotPath
    const reader = createMockFsReader({ [absolutePath]: serializeCanvas(SNAPSHOT_CANVAS) })

    await restorePatternSnapshot(snapshotPath, '/vault', reader)
    await restorePatternSnapshot(snapshotPath, '/vault', reader)

    const nodes = useCanvasStore.getState().nodes
    expect(nodes).toHaveLength(2) // Not 4
  })

  it('deduplicates edges when restoring the same snapshot twice', async () => {
    const nodeA = createCanvasNode('terminal', { x: 0, y: 0 })
    const nodeB = createCanvasNode('project-file', { x: 300, y: 0 })
    const snapshotWithEdges = {
      nodes: [nodeA, nodeB],
      edges: [
        {
          id: 'edge-1',
          fromNode: nodeA.id,
          toNode: nodeB.id,
          fromSide: 'right' as const,
          toSide: 'left' as const,
          kind: 'connection' as const
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const path = 'snapshot.canvas.json'
    const reader = createMockFsReader({ ['/vault/' + path]: serializeCanvas(snapshotWithEdges) })

    await restorePatternSnapshot(path, '/vault', reader)
    await restorePatternSnapshot(path, '/vault', reader)

    expect(useCanvasStore.getState().nodes).toHaveLength(2) // Not 4
    expect(useCanvasStore.getState().edges).toHaveLength(1) // Not 2
  })

  it('restores edges from the snapshot', async () => {
    const nodeA = createCanvasNode('terminal', { x: 0, y: 0 })
    const nodeB = createCanvasNode('project-file', { x: 300, y: 0 })
    const snapshotWithEdges = {
      nodes: [nodeA, nodeB],
      edges: [
        {
          id: 'edge-1',
          fromNode: nodeA.id,
          toNode: nodeB.id,
          fromSide: 'right' as const,
          toSide: 'left' as const,
          kind: 'connection' as const
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const path = 'snapshot.canvas.json'
    const reader = createMockFsReader({ ['/vault/' + path]: serializeCanvas(snapshotWithEdges) })

    await restorePatternSnapshot(path, '/vault', reader)

    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(useCanvasStore.getState().edges).toHaveLength(1)
    expect(useCanvasStore.getState().edges[0].kind).toBe('connection')
  })
})
