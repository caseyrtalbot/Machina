import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors } from '../../../design/tokens'

export function ToolCallRenderer({
  call,
  result
}: {
  readonly call: ToolCall
  readonly result?: ToolResult
}) {
  const status = result ? (result.ok ? 'ok' : 'error') : 'pending'
  return (
    <div
      data-testid="tool-call-stub"
      style={{ fontSize: 11, color: colors.text.muted, marginTop: 8 }}
    >
      tool: {call.kind} {status}
    </div>
  )
}
