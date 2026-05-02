import type { ToolCall, ToolError } from '@shared/thread-types'
import { borderRadius } from '../../../design/tokens'

export function ToolErrorCard({
  call,
  error
}: {
  readonly call: ToolCall
  readonly error: ToolError
}) {
  return (
    <div
      style={{
        padding: 8,
        background: 'rgba(255, 80, 80, 0.06)',
        border: '1px solid rgba(255, 80, 80, 0.4)',
        borderRadius: borderRadius.inline,
        marginTop: 8
      }}
    >
      <div style={{ fontSize: 12 }}>
        {call.kind} · {error.code}: {error.message}
      </div>
      {error.hint && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{error.hint}</div>}
    </div>
  )
}
