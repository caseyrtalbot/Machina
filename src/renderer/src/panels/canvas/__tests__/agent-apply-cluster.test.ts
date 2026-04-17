import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '../../../store/canvas-store'
import { useVaultStore } from '../../../store/vault-store'
import { CommandStack } from '../canvas-commands'
import { applyAgentResult } from '../agent-apply'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { ClusterDraft } from '@shared/cluster-types'

const mockMaterialize = vi.fn()
const mockUnmaterialize = vi.fn()

;(window as unknown as Record<string, unknown>).api = {
  artifact: {
    materialize: mockMaterialize,
    unmaterialize: mockUnmaterialize
  }
} as never

function baseCluster(): ClusterDraft {
  return {
    kind: 'cluster',
    title: 'T',
    prompt: 'p',
    origin: 'agent',
    sources: [],
    sections: [
      { cardId: 'card1', heading: 'A', body: 'a' },
      { cardId: 'card2', heading: 'B', body: 'b' }
    ]
  }
}

function seedTwoTextCards(): void {
  useCanvasStore.setState({
    ...useCanvasStore.getInitialState(),
    nodes: [
      {
        id: 'card1',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 },
        content: 'a',
        metadata: { cluster_id: 'cl-xyz' }
      },
      {
        id: 'card2',
        type: 'text',
        position: { x: 0, y: 120 },
        size: { width: 200, height: 100 },
        content: 'b',
        metadata: { cluster_id: 'cl-xyz' }
      }
    ],
    edges: []
  })
}

function planFor(draft: ClusterDraft): CanvasMutationPlan {
  return {
    id: 'p1',
    operationId: 'op1',
    source: 'agent',
    ops: [
      {
        type: 'materialize-artifact',
        draft,
        placement: { x: 0, y: 0, width: 400, height: 300 },
        tempNodeId: 'tmp-cluster'
      },
      { type: 'update-metadata', nodeId: 'card1', metadata: { __convertToFileView: true } },
      { type: 'update-metadata', nodeId: 'card2', metadata: { __convertToFileView: true } }
    ],
    summary: { addedNodes: 1, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
  }
}

describe('applyAgentResult (cluster)', () => {
  let commandStack: CommandStack

  beforeEach(() => {
    seedTwoTextCards()
    useVaultStore.setState({
      ...useVaultStore.getInitialState(),
      vaultPath: '/tmp/vault',
      config: {
        version: 1,
        fonts: { display: '', body: '', mono: '' },
        workspaces: [],
        createdAt: '',
        compile: { persistenceEnabled: true, outputDir: 'compiled/' },
        cluster: { captureEnabled: true, outputDir: 'clusters/' }
      }
    })
    commandStack = new CommandStack()
    mockMaterialize.mockReset()
    mockUnmaterialize.mockReset()
    mockMaterialize.mockResolvedValue({
      vaultRelativePath: 'clusters/foo.md',
      absolutePath: '/tmp/vault/clusters/foo.md',
      artifactId: 'cl-xyz'
    })
  })

  it('materializes the cluster and converts its cards to file-view with section projections', async () => {
    await applyAgentResult(planFor(baseCluster()), commandStack)

    const nodes = useCanvasStore.getState().nodes
    const card1 = nodes.find((n) => n.id === 'card1')
    const card2 = nodes.find((n) => n.id === 'card2')
    expect(card1?.type).toBe('file-view')
    expect(card1?.content).toBe('clusters/foo.md')
    expect(card1?.metadata.section).toBe('card1')
    expect((card1?.metadata as { sectionMap?: Record<string, string> }).sectionMap).toEqual({
      card1: 'A',
      card2: 'B'
    })
    expect(card2?.type).toBe('file-view')
    expect(card2?.metadata.section).toBe('card2')
  })

  it('rejects cluster drafts when capture is disabled', async () => {
    useVaultStore.setState({
      ...useVaultStore.getState(),
      config: {
        ...useVaultStore.getState().config!,
        cluster: { captureEnabled: false }
      }
    })
    await expect(applyAgentResult(planFor(baseCluster()), commandStack)).rejects.toThrow(/disabled/)
  })

  it('rejects cluster drafts when persistence is disabled', async () => {
    useVaultStore.setState({
      ...useVaultStore.getState(),
      config: {
        ...useVaultStore.getState().config!,
        compile: { persistenceEnabled: false },
        cluster: { captureEnabled: true }
      }
    })
    await expect(applyAgentResult(planFor(baseCluster()), commandStack)).rejects.toThrow(
      /persistence/i
    )
  })

  it('does not regress compiled-article apply path', async () => {
    // A compiled-article still becomes a single new file-view card.
    mockMaterialize.mockResolvedValue({
      vaultRelativePath: 'compiled/foo.md',
      absolutePath: '/tmp/vault/compiled/foo.md',
      artifactId: 'uuid-1'
    })
    const plan: CanvasMutationPlan = {
      id: 'p2',
      operationId: 'op2',
      source: 'agent',
      ops: [
        {
          type: 'materialize-artifact',
          draft: {
            kind: 'compiled-article',
            title: 'c',
            body: 'b',
            origin: 'agent',
            sources: []
          },
          placement: { x: 1, y: 2, width: 10, height: 20 },
          tempNodeId: 'new-card'
        }
      ],
      summary: {
        addedNodes: 1,
        addedEdges: 0,
        movedNodes: 0,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    }
    await applyAgentResult(plan, commandStack)
    const newCard = useCanvasStore.getState().nodes.find((n) => n.id === 'new-card')
    expect(newCard?.type).toBe('file-view')
    expect(newCard?.content).toBe('compiled/foo.md')
  })
})
