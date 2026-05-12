import { CARD_TYPE_INFO } from './canvas-types'
import type { CanvasEdge, CanvasNode, CanvasNodeType, CanvasSide } from './canvas-types'
import type { CanvasMutationOp } from './canvas-mutation-types'

const CANVAS_SIDES = new Set<CanvasSide>(['top', 'right', 'bottom', 'left'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCanvasNodeType(value: unknown): value is CanvasNodeType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CARD_TYPE_INFO, value)
}

function isCanvasSide(value: unknown): value is CanvasSide {
  return typeof value === 'string' && CANVAS_SIDES.has(value as CanvasSide)
}

function validatePosition(value: unknown, field: string): string | null {
  if (!isRecord(value)) return `${field}: must be an object`
  if (!isFiniteNumber(value.x)) return `${field}.x must be a finite number`
  if (!isFiniteNumber(value.y)) return `${field}.y must be a finite number`
  return null
}

function validateSize(value: unknown, field: string): string | null {
  if (!isRecord(value)) return `${field}: must be an object`
  if (!isFiniteNumber(value.width) || value.width <= 0) {
    return `${field}.width must be a positive finite number`
  }
  if (!isFiniteNumber(value.height) || value.height <= 0) {
    return `${field}.height must be a positive finite number`
  }
  return null
}

function validateNode(value: unknown): string | null {
  if (!isRecord(value)) return 'add-node: node must be an object'
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return 'add-node: node.id is required'
  }
  if (!isCanvasNodeType(value.type)) return 'add-node: node.type is invalid'

  const positionError = validatePosition(value.position, 'add-node: node.position')
  if (positionError) return positionError

  const sizeError = validateSize(value.size, 'add-node: node.size')
  if (sizeError) return sizeError

  if (typeof value.content !== 'string') return 'add-node: node.content must be a string'
  if (!isRecord(value.metadata)) return 'add-node: node.metadata must be an object'
  return null
}

function validateEdge(value: unknown): string | null {
  if (!isRecord(value)) return 'add-edge: edge must be an object'
  if (typeof value.id !== 'string' || value.id.length === 0) return 'add-edge: edge.id is required'
  if (typeof value.fromNode !== 'string' || value.fromNode.length === 0) {
    return 'add-edge: edge.fromNode is required'
  }
  if (typeof value.toNode !== 'string' || value.toNode.length === 0) {
    return 'add-edge: edge.toNode is required'
  }
  if (!isCanvasSide(value.fromSide)) return 'add-edge: edge.fromSide is invalid'
  if (!isCanvasSide(value.toSide)) return 'add-edge: edge.toSide is invalid'
  return null
}

function validateCanvasMutationOp(
  op: CanvasMutationOp,
  existingNodeIds: Set<string>,
  addedNodeIds: Set<string>
): string | null {
  switch (op.type) {
    case 'add-node': {
      const nodeError = validateNode(op.node)
      if (nodeError) return nodeError
      if (existingNodeIds.has(op.node.id)) return `add-node: nodeId ${op.node.id} already exists`
      if (addedNodeIds.has(op.node.id)) return `add-node: nodeId ${op.node.id} duplicated in plan`
      addedNodeIds.add(op.node.id)
      return null
    }
    case 'add-edge': {
      const edgeError = validateEdge(op.edge)
      if (edgeError) return edgeError
      if (!existingNodeIds.has(op.edge.fromNode) && !addedNodeIds.has(op.edge.fromNode)) {
        return `add-edge: fromNode ${op.edge.fromNode} not found`
      }
      if (!existingNodeIds.has(op.edge.toNode) && !addedNodeIds.has(op.edge.toNode)) {
        return `add-edge: toNode ${op.edge.toNode} not found`
      }
      return null
    }
    case 'move-node':
      if (!existingNodeIds.has(op.nodeId)) return `move-node: nodeId ${op.nodeId} not found`
      return validatePosition(op.position, 'move-node: position')
    case 'resize-node':
      if (!existingNodeIds.has(op.nodeId)) return `resize-node: nodeId ${op.nodeId} not found`
      return validateSize(op.size, 'resize-node: size')
    case 'update-metadata':
      if (!existingNodeIds.has(op.nodeId)) return `update-metadata: nodeId ${op.nodeId} not found`
      if (!isRecord(op.metadata)) return 'update-metadata: metadata must be an object'
      return null
    case 'update-node':
      if (!existingNodeIds.has(op.nodeId)) return `update-node: nodeId ${op.nodeId} not found`
      if (op.nodeType !== undefined && !isCanvasNodeType(op.nodeType)) {
        return 'update-node: nodeType is invalid'
      }
      if (op.content !== undefined && typeof op.content !== 'string') {
        return 'update-node: content must be a string'
      }
      if (op.metadata !== undefined && !isRecord(op.metadata)) {
        return 'update-node: metadata must be an object'
      }
      return null
    case 'remove-node':
      if (!existingNodeIds.has(op.nodeId)) return `remove-node: nodeId ${op.nodeId} not found`
      return null
    case 'remove-edge':
      return null
    case 'materialize-artifact':
      return 'materialize-artifact: must be rewritten before canvas apply-plan'
  }
}

export function validateCanvasMutationOps(
  ops: readonly CanvasMutationOp[],
  existingNodes: readonly Pick<CanvasNode, 'id'>[],
  _existingEdges: readonly Pick<CanvasEdge, 'id'>[] = []
): string | null {
  const existingNodeIds = new Set(existingNodes.map((node) => node.id))
  const addedNodeIds = new Set<string>()

  for (const op of ops) {
    const error = validateCanvasMutationOp(op, existingNodeIds, addedNodeIds)
    if (error) return error
  }

  return null
}
