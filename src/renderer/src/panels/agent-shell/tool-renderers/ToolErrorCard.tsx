import type { ToolCall, ToolError } from '@shared/thread-types'
import { borderRadius } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'

export function ToolErrorCard({
  call,
  error
}: {
  readonly call: ToolCall
  readonly error: ToolError
}) {
  const summary = `${call.kind} · ${error.code}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-error',
      label: 'Copy error',
      onSelect: () => void copyText(summary)
    },
    {
      id: 'copy-code',
      label: 'Copy error code',
      onSelect: () => void copyText(error.code)
    }
  ])
  return (
    <div
      onContextMenu={onContextMenu}
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
      {menu}
    </div>
  )
}
