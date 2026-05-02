import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'

type ReadNoteCall = Extract<ToolCall, { kind: 'read_note' }>

export function ReadNoteCard({
  call,
  result
}: {
  readonly call: ReadNoteCall
  readonly result?: ToolResult
}) {
  const lines =
    result && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { lines?: string }).lines ?? '')
      : ''
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: borderRadius.inline,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        fontSize: 12,
        color: colors.text.primary,
        textDecoration: 'none',
        marginTop: 8
      }}
    >
      <span style={{ opacity: 0.6 }}>📄</span>
      {call.args.path}
      {lines && <span style={{ opacity: 0.6 }}>· {lines}</span>}
    </a>
  )
}
