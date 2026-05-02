import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors } from '../../../design/tokens'
import { ToolCardShell } from './ToolCardShell'

type ReadCanvasCall = Extract<ToolCall, { kind: 'read_canvas' }>

export function ReadCanvasCard({
  call,
  result
}: {
  readonly call: ReadCanvasCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const cardCount =
    settled && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { cards?: unknown[] }).cards?.length ?? 0)
      : 0
  const edgeCount =
    settled && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { edges?: unknown[] }).edges?.length ?? 0)
      : 0

  return (
    <ToolCardShell
      variant="pill"
      inline
      style={{ gap: 6, color: settled ? colors.text.primary : colors.text.muted }}
    >
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
      style={{ flexShrink: 0, opacity: 0.65 }}
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
