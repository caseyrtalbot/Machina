import type { ToolCall, ToolResult } from '@shared/thread-types'
import { maskSecretsInText } from './mask-secrets'
import { CliCommandCard } from './CliCommandCard'
import { EditNoteCard } from './EditNoteCard'
import { ListVaultCard } from './ListVaultCard'
import { PinToCanvasCard } from './PinToCanvasCard'
import { ReadCanvasCard } from './ReadCanvasCard'
import { ReadNoteCard } from './ReadNoteCard'
import { SearchVaultCard } from './SearchVaultCard'
import { ToolCardShell } from './ToolCardShell'
import { ToolErrorCard } from './ToolErrorCard'
import { WriteNoteCard } from './WriteNoteCard'

export function ToolCallRenderer({
  call,
  result,
  historical
}: {
  readonly call: ToolCall
  readonly result?: ToolResult
  /** True when rendering a finalized (persisted) message: a result-less call
   *  can never settle anymore, so unsettled affordances must not render. */
  readonly historical?: boolean
}) {
  // write_note / edit_note own their own rejected-state UI (the diff card
  // shows "you rejected this write" instead of a generic error chip).
  if (call.kind === 'write_note') {
    return <WriteNoteCard call={call} result={result} historical={historical} />
  }
  if (call.kind === 'edit_note') {
    return <EditNoteCard call={call} result={result} historical={historical} />
  }
  // cli_command renders its own ok/failed states with an exit-code badge.
  if (call.kind === 'cli_command') {
    return <CliCommandCard call={call} result={result} />
  }
  if (result && !result.ok) {
    return <ToolErrorCard call={call} error={result.error} />
  }
  switch (call.kind) {
    case 'read_note':
      return <ReadNoteCard call={call} result={result} />
    case 'list_vault':
      return <ListVaultCard call={call} result={result} />
    case 'search_vault':
      return <SearchVaultCard call={call} result={result} />
    case 'read_canvas':
      return <ReadCanvasCard call={call} result={result} />
    case 'pin_to_canvas':
      return <PinToCanvasCard call={call} result={result} />
    default: {
      const rawPreview = (call.args as Record<string, unknown>).preview
      // Agent tool input (e.g. a Bash command) can carry secrets — mask like
      // the cli_command output card does, so the pill can't leak in clear.
      const preview =
        typeof rawPreview === 'string' && rawPreview.length > 0
          ? maskSecretsInText(rawPreview)
          : null
      return (
        <ToolCardShell variant="pill" inline>
          <span className="te-tool-unknown-label">
            tool: {call.kind} {unknownToolStatus(call, result, historical)}
          </span>
          {preview && <span className="te-tool-unknown-preview">{preview}</span>}
        </ToolCardShell>
      )
    }
  }
}

/**
 * Honest settlement status, independent of the failed-result early return
 * above (which routes ok=false to ToolErrorCard before we get here).
 */
function unknownToolStatus(
  call: ToolCall,
  result: ToolResult | undefined,
  historical: boolean | undefined
): string {
  if (result) return result.ok ? 'ok' : 'failed'
  // cli_* trace entries observed from a CLI agent's output never settle —
  // they are records of something that already happened.
  if (call.kind.startsWith('cli_')) return 'observed'
  // In a finalized message a result-less call can never resolve: it was
  // interrupted before running, not "pending".
  return historical ? 'not run' : 'pending'
}
