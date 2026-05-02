import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors } from '../../../design/tokens'
import { ListVaultCard } from './ListVaultCard'
import { ReadNoteCard } from './ReadNoteCard'
import { SearchVaultCard } from './SearchVaultCard'
import { ToolErrorCard } from './ToolErrorCard'

export function ToolCallRenderer({
  call,
  result
}: {
  readonly call: ToolCall
  readonly result?: ToolResult
}) {
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
    default:
      return (
        <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 8 }}>
          tool: {call.kind} {result ? 'ok' : 'pending'}
        </div>
      )
  }
}
