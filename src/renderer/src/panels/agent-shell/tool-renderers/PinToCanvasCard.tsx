import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'

type PinCall = Extract<ToolCall, { kind: 'pin_to_canvas' }>

export function PinToCanvasCard({
  call,
  result
}: {
  readonly call: PinCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const succeeded = settled && result.ok
  const cardId =
    succeeded && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { cardId?: string }).cardId ?? '')
      : ''

  const title = call.args.card.title
  const refs = call.args.card.refs ?? []

  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 10px',
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}
    >
      <span style={{ opacity: 0.7 }}>📌</span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <div
          style={{
            color: colors.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          <strong>{title || '(untitled)'}</strong>
          <span style={{ color: colors.text.muted, marginLeft: 6 }}>→ {call.args.canvasId}</span>
        </div>
        {refs.length > 0 && (
          <div style={{ color: colors.text.muted, fontSize: 11, marginTop: 2 }}>
            refs: {refs.join(', ')}
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: colors.text.muted, whiteSpace: 'nowrap' }}>
        {!settled ? 'pinning…' : succeeded ? `pinned · ${cardId}` : 'failed'}
      </span>
    </div>
  )
}
