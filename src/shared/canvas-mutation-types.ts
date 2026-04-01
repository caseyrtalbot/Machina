import type { CanvasNode, CanvasEdge } from './canvas-types'

export type CanvasMutationOp =
  | { readonly type: 'add-node'; readonly node: CanvasNode }
  | { readonly type: 'add-edge'; readonly edge: CanvasEdge }
  | {
      readonly type: 'move-node'
      readonly nodeId: string
      readonly position: { x: number; y: number }
    }
  | {
      readonly type: 'resize-node'
      readonly nodeId: string
      readonly size: { width: number; height: number }
    }
  | {
      readonly type: 'update-metadata'
      readonly nodeId: string
      readonly metadata: Partial<Record<string, unknown>>
    }
  | { readonly type: 'remove-node'; readonly nodeId: string }
  | { readonly type: 'remove-edge'; readonly edgeId: string }

export interface CanvasMutationPlan {
  readonly id: string
  readonly operationId: string
  readonly source: 'folder-map' | 'agent' | 'expand-folder'
  readonly ops: readonly CanvasMutationOp[]
  readonly summary: {
    readonly addedNodes: number
    readonly addedEdges: number
    readonly movedNodes: number
    readonly skippedFiles: number
    readonly unresolvedRefs: number
  }
}

export function applyPlanOps(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  ops: readonly CanvasMutationOp[]
): { readonly nodes: readonly CanvasNode[]; readonly edges: readonly CanvasEdge[] } {
  let currentNodes = [...nodes]
  let currentEdges = [...edges]

  for (const op of ops) {
    switch (op.type) {
      case 'add-node':
        currentNodes = [...currentNodes, op.node]
        break

      case 'add-edge':
        currentEdges = [...currentEdges, op.edge]
        break

      case 'move-node':
        currentNodes = currentNodes.map((n) =>
          n.id === op.nodeId ? { ...n, position: { ...op.position } } : n
        )
        break

      case 'resize-node':
        currentNodes = currentNodes.map((n) =>
          n.id === op.nodeId ? { ...n, size: { ...op.size } } : n
        )
        break

      case 'update-metadata':
        currentNodes = currentNodes.map((n) =>
          n.id === op.nodeId ? { ...n, metadata: { ...n.metadata, ...op.metadata } } : n
        )
        break

      case 'remove-node': {
        currentNodes = currentNodes.filter((n) => n.id !== op.nodeId)
        currentEdges = currentEdges.filter(
          (e) => e.fromNode !== op.nodeId && e.toNode !== op.nodeId
        )
        break
      }

      case 'remove-edge':
        currentEdges = currentEdges.filter((e) => e.id !== op.edgeId)
        break
    }
  }

  return { nodes: currentNodes, edges: currentEdges }
}

function edgeSignature(
  edge: Pick<
    CanvasEdge,
    'fromNode' | 'toNode' | 'fromSide' | 'toSide' | 'kind' | 'label' | 'hidden'
  >
): string {
  return [
    edge.fromNode,
    edge.toNode,
    edge.fromSide,
    edge.toSide,
    edge.kind ?? '',
    edge.label ?? '',
    edge.hidden ? '1' : '0'
  ].join('\u0000')
}

export function filterCanvasAdditions(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  existingNodes: readonly Pick<CanvasNode, 'id'>[],
  existingEdges: readonly Pick<
    CanvasEdge,
    'fromNode' | 'toNode' | 'fromSide' | 'toSide' | 'kind' | 'label' | 'hidden'
  >[]
): {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
} {
  const retainedNodes: CanvasNode[] = []
  const availableNodeIds = new Set(existingNodes.map((node) => node.id))

  for (const node of nodes) {
    if (availableNodeIds.has(node.id)) continue
    availableNodeIds.add(node.id)
    retainedNodes.push(node)
  }

  const existingEdgeSignatures = new Set(existingEdges.map((edge) => edgeSignature(edge)))
  const retainedEdges: CanvasEdge[] = []
  const addedEdgeSignatures = new Set<string>()

  for (const edge of edges) {
    if (!availableNodeIds.has(edge.fromNode) || !availableNodeIds.has(edge.toNode)) continue

    const signature = edgeSignature(edge)
    if (existingEdgeSignatures.has(signature) || addedEdgeSignatures.has(signature)) continue

    addedEdgeSignatures.add(signature)
    retainedEdges.push(edge)
  }

  return { nodes: retainedNodes, edges: retainedEdges }
}

export function buildFolderMapPlan(
  operationId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  skippedFiles: number,
  unresolvedRefs: number
): CanvasMutationPlan {
  const ops: CanvasMutationOp[] = [
    ...nodes.map((node) => ({ type: 'add-node' as const, node })),
    ...edges.map((edge) => ({ type: 'add-edge' as const, edge }))
  ]
  return {
    id: `plan_${Date.now().toString(36)}`,
    operationId,
    source: 'folder-map',
    ops,
    summary: {
      addedNodes: nodes.length,
      addedEdges: edges.length,
      movedNodes: 0,
      skippedFiles,
      unresolvedRefs
    }
  }
}
