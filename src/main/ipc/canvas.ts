import { typedHandle } from '../typed-ipc'
import { readFile, stat } from 'fs/promises'
import type { CanvasFile } from '@shared/canvas-types'
import type { CanvasMutationOp } from '@shared/canvas-mutation-types'

function validateOp(
  op: CanvasMutationOp,
  existingNodeIds: Set<string>,
  addedNodeIds: Set<string>
): string | null {
  switch (op.type) {
    case 'add-node':
      if (!op.node.type || !op.node.position || !op.node.size)
        return 'add-node: missing required fields'
      if (existingNodeIds.has(op.node.id)) return `add-node: nodeId ${op.node.id} already exists`
      if (addedNodeIds.has(op.node.id)) return `add-node: nodeId ${op.node.id} duplicated in plan`
      addedNodeIds.add(op.node.id)
      return null
    case 'add-edge':
      if (!existingNodeIds.has(op.edge.fromNode) && !addedNodeIds.has(op.edge.fromNode))
        return `add-edge: fromNode ${op.edge.fromNode} not found`
      if (!existingNodeIds.has(op.edge.toNode) && !addedNodeIds.has(op.edge.toNode))
        return `add-edge: toNode ${op.edge.toNode} not found`
      return null
    case 'move-node':
    case 'resize-node':
    case 'update-metadata':
      if (!existingNodeIds.has(op.nodeId)) return `${op.type}: nodeId ${op.nodeId} not found`
      return null
    case 'remove-node':
      if (!existingNodeIds.has(op.nodeId)) return `remove-node: nodeId ${op.nodeId} not found`
      return null
    case 'remove-edge':
      return null
    default:
      return 'unknown op type'
  }
}

export function registerCanvasIpc(): void {
  typedHandle('canvas:get-snapshot', async (args) => {
    const content = await readFile(args.canvasPath, 'utf-8')
    const file: CanvasFile = JSON.parse(content)
    const stats = await stat(args.canvasPath)
    return { file, mtime: stats.mtime.toISOString() }
  })

  typedHandle('canvas:apply-plan', async (args) => {
    // Optimistic lock: check mtime
    const stats = await stat(args.canvasPath)
    const currentMtime = stats.mtime.toISOString()
    if (currentMtime !== args.expectedMtime) {
      return {
        error: 'stale' as const,
        message: `Canvas modified since snapshot (expected ${args.expectedMtime}, got ${currentMtime})`
      }
    }

    // Validate all ops
    const content = await readFile(args.canvasPath, 'utf-8')
    const file: CanvasFile = JSON.parse(content)
    const existingNodeIds = new Set(file.nodes.map((n) => n.id))
    const addedNodeIds = new Set<string>()

    for (const op of args.plan.ops) {
      const error = validateOp(op, existingNodeIds, addedNodeIds)
      if (error) {
        return { error: 'validation-failed' as const, message: error }
      }
    }

    // Validation passed -- actual apply happens in the renderer via preview/apply flow
    return { applied: true, mtime: currentMtime }
  })
}
