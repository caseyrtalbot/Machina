import type { ToolCall, ToolResult } from '@shared/thread-types'
import { unwrapSpotlighting } from '@shared/spotlighting'
import { ToolCardShell } from './ToolCardShell'

type ReadCanvasCall = Extract<ToolCall, { kind: 'read_canvas' }>

// read_canvas serializes { version, viewport, cards, edges } into a
// Spotlighting-wrapped `snapshot` string (nodes/edges are untrusted vault
// content). Unwrap + parse it back to count cards/edges for display; a
// malformed or absent payload degrades to zero.
function parseCounts(output: unknown): { cards: number; edges: number } {
  if (typeof output !== 'object' || output === null) return { cards: 0, edges: 0 }
  const snapshot = (output as { snapshot?: unknown }).snapshot
  if (typeof snapshot !== 'string') return { cards: 0, edges: 0 }
  try {
    const parsed = JSON.parse(unwrapSpotlighting(snapshot)) as {
      cards?: unknown[]
      edges?: unknown[]
    }
    return {
      cards: Array.isArray(parsed.cards) ? parsed.cards.length : 0,
      edges: Array.isArray(parsed.edges) ? parsed.edges.length : 0
    }
  } catch {
    return { cards: 0, edges: 0 }
  }
}

export function ReadCanvasCard({
  call,
  result
}: {
  readonly call: ReadCanvasCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const { cards: cardCount, edges: edgeCount } =
    settled && result.ok ? parseCounts(result.output) : { cards: 0, edges: 0 }

  return (
    <ToolCardShell variant="pill" inline pending={!settled} className="te-tool-canvas-pill">
      <CanvasGlyph />
      <span>
        {!settled
          ? `reading canvas ${call.args.canvasId}…`
          : `read ${cardCount} ${cardCount === 1 ? 'card' : 'cards'} / ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'} from ${call.args.canvasId}`}
      </span>
    </ToolCardShell>
  )
}

function CanvasGlyph() {
  return (
    <svg
      aria-hidden
      width={11}
      height={11}
      viewBox="0 0 11 11"
      className="te-tool-glyph te-tool-glyph--dim"
    >
      <rect
        x={0.5}
        y={0.5}
        width={4}
        height={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect
        x={6.5}
        y={0.5}
        width={4}
        height={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect
        x={0.5}
        y={6.5}
        width={4}
        height={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect
        x={6.5}
        y={6.5}
        width={4}
        height={4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </svg>
  )
}
