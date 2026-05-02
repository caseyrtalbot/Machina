import type { ToolCall, ToolError } from '@shared/thread-types'
import { colors, typography } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

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
    <ToolCardShell variant="error" onContextMenu={onContextMenu}>
      <div
        style={{
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.diff.removed,
          marginBottom: 4
        }}
      >
        {call.kind} · {error.code}
      </div>
      <div style={{ fontSize: 12, color: colors.text.primary }}>{error.message}</div>
      {error.hint && (
        <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>{error.hint}</div>
      )}
      {menu}
    </ToolCardShell>
  )
}
