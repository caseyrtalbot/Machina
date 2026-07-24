import type { ToolCall, ToolResult } from '@shared/thread-types'
import { ToolCardShell } from './ToolCardShell'

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
    <ToolCardShell variant="block" pending={!settled} className="te-tool-pin">
      <PinGlyph />
      <div className="te-tool-pin-body">
        <div className="te-tool-pin-title">
          <strong>{title || '(untitled)'}</strong>
          <span className="te-tool-pin-arrow">→ {call.args.canvasId}</span>
        </div>
        {refs.length > 0 && <div className="te-tool-pin-refs">refs: {refs.join(', ')}</div>}
      </div>
      <span className="te-tool-pin-status">
        {!settled ? 'pinning' : succeeded ? `pinned · ${cardId}` : 'failed'}
      </span>
    </ToolCardShell>
  )
}

function PinGlyph() {
  return (
    <svg aria-hidden width={11} height={13} viewBox="0 0 11 13" className="te-tool-glyph">
      <path
        d="M5.5 .5 L8.5 3.5 L7.2 4.8 L8 8.5 L3 8.5 L3.8 4.8 L2.5 3.5 Z M5.5 8.5 L5.5 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  )
}
