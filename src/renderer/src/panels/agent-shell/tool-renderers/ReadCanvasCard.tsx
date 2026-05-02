import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'

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
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: borderRadius.inline,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        fontSize: 12,
        color: settled ? colors.text.primary : colors.text.muted,
        marginTop: 8
      }}
    >
      <span style={{ opacity: 0.6 }}>◫</span>
      {!settled
        ? `reading canvas ${call.args.canvasId}…`
        : `read ${cardCount} ${cardCount === 1 ? 'card' : 'cards'} / ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'} from ${call.args.canvasId}`}
    </div>
  )
}
