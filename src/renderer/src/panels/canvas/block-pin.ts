import type { Block } from '@shared/engine/block-model'
import type { CanvasNode } from '@shared/canvas-types'
import { createCanvasNode } from '@shared/canvas-types'
import {
  stripTerminalControls,
  extractCommand,
  dropPromptHeader
} from '@shared/engine/terminal-text'
import { segmentOutput, maskSegmentText } from '@shared/engine/block-output-segments'
import { scanSecrets } from '@shared/engine/secrets'

const PIN_GAP = 24

/** Archived output snapshot cap — keeps pinned cards renderable after restart
 * without persisting unbounded output into canvas.json. */
export const PIN_OUTPUT_SNAPSHOT_MAX = 8 * 1024

/** Replace any scanSecrets hits with mask glyphs. Idempotent on masked text. */
export function maskSecrets(text: string): string {
  if (text.length === 0) return text
  const secrets = scanSecrets(text)
  if (secrets.length === 0) return text
  return segmentOutput(text, secrets)
    .map((seg) => (seg.secret ? maskSegmentText(seg.text) : seg.text))
    .join('')
}

/**
 * Build a `terminal-block` CanvasNode that projects an existing Block.
 * Position is to the right of the source terminal card with PIN_GAP.
 * Caller is responsible for inserting the node into the canvas store.
 *
 * Metadata persists the resolved command and a truncated, secret-masked
 * output snapshot so the card survives app restart (when the live block is
 * gone from the store).
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

  const cleaned = stripTerminalControls(block.outputText)
  const command = maskSecrets((block.command || extractCommand(cleaned)).trim())
  // Keep the tail — that's what the user last saw in the terminal.
  const outputSnapshot = maskSecrets(dropPromptHeader(cleaned)).slice(-PIN_OUTPUT_SNAPSHOT_MAX)

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
        command,
        exitCode,
        startedAtMs,
        finishedAtMs,
        cwd: block.metadata.cwd,
        outputSnapshot
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
