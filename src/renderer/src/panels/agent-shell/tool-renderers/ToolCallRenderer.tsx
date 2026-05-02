import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors } from '../../../design/tokens'
import { EditNoteCard } from './EditNoteCard'
import { ListVaultCard } from './ListVaultCard'
import { PinToCanvasCard } from './PinToCanvasCard'
import { ReadCanvasCard } from './ReadCanvasCard'
import { ReadNoteCard } from './ReadNoteCard'
import { SearchVaultCard } from './SearchVaultCard'
import { ToolErrorCard } from './ToolErrorCard'
import { WriteNoteCard } from './WriteNoteCard'

export function ToolCallRenderer({
  call,
  result
}: {
  readonly call: ToolCall
  readonly result?: ToolResult
}) {
  // write_note / edit_note own their own rejected-state UI (the diff card
  // shows "you rejected this write" instead of a generic error chip).
  if (call.kind === 'write_note') {
    return <WriteNoteCard call={call} result={result} />
  }
  if (call.kind === 'edit_note') {
    return <EditNoteCard call={call} result={result} />
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
    default:
      return (
        <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 8 }}>
          tool: {call.kind} {result ? 'ok' : 'pending'}
        </div>
      )
  }
}
