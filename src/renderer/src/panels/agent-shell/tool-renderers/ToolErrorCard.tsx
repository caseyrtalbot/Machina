import type { ToolCall, ToolError } from '@shared/thread-types'
import { maskSecretsInText } from './mask-secrets'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

export function ToolErrorCard({
  call,
  error
}: {
  readonly call: ToolCall
  readonly error: ToolError
}) {
  // error.hint carries tool input / output tails (codex routes inputPreview
  // here) — mask secrets before display, and copy what is displayed.
  const message = maskSecretsInText(error.message)
  const hint = error.hint ? maskSecretsInText(error.hint) : undefined
  const summary = `${call.kind} · ${error.code}: ${message}${hint ? ` (${hint})` : ''}`
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
      <div className="te-tool-error-code">
        {call.kind} · {error.code}
      </div>
      <div className="te-tool-error-msg">{message}</div>
      {hint && <div className="te-tool-error-hint">{hint}</div>}
      {menu}
    </ToolCardShell>
  )
}
