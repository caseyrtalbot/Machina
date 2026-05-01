import type { Block } from '@shared/engine/block-model'
import type { CanvasNode } from '@shared/canvas-types'
import { createCanvasNode } from '@shared/canvas-types'

const PIN_GAP = 24

/**
 * Build a `terminal-block` CanvasNode that projects an existing Block.
 * Position is to the right of the source terminal card with PIN_GAP.
 * Caller is responsible for inserting the node into the canvas store.
 */
export function buildBlockProjection(sourceNode: CanvasNode, block: Block): CanvasNode {
  const startedAtMs =
    block.state.kind === 'running' ||
    block.state.kind === 'completed' ||
    block.state.kind === 'cancelled'
      ? block.state.startedAt
      : null
  const finishedAtMs =
    block.state.kind === 'completed' || block.state.kind === 'cancelled'
      ? block.state.finishedAt
      : null
  const exitCode = block.state.kind === 'completed' ? block.state.exitCode : null

  return createCanvasNode(
    'terminal-block',
    {
      x: sourceNode.position.x + sourceNode.size.width + PIN_GAP,
      y: sourceNode.position.y
    },
    {
      metadata: {
        sessionId: block.metadata.sessionId,
        blockId: block.id,
        command: block.command,
        exitCode,
        startedAtMs,
        finishedAtMs,
        cwd: block.metadata.cwd,
        agentContext: block.agentContext
      }
    }
  )
}

/**
 * Pick the block to pin from a session's ordered list. Prefers the most
 * recent completed/cancelled block; falls back to the most recent overall.
 */
export function pickPinnableBlock(blocks: readonly Block[]): Block | null {
  if (blocks.length === 0) return null
  for (let i = blocks.length - 1; i >= 0; i--) {
    const k = blocks[i].state.kind
    if (k === 'completed' || k === 'cancelled') return blocks[i]
  }
  return blocks[blocks.length - 1]
}
