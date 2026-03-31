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
