import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'

type EditNoteCall = Extract<ToolCall, { kind: 'edit_note' }>

const PREVIEW_LIMIT = 40

export function EditNoteCard({
  call,
  result
}: {
  readonly call: EditNoteCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const accepted = settled && result.ok
  const rejected = settled && !result.ok
  const [submitting, setSubmitting] = useState(false)

  async function decide(accept: boolean) {
    if (settled || submitting) return
    setSubmitting(true)
    try {
      await window.api.agentNative.toolDecision({ toolUseId: call.id, accept })
    } finally {
      setSubmitting(false)
    }
  }

  const findLines = call.args.find.split('\n')
  const replaceLines = call.args.replace.split('\n')
  const status = !settled ? 'awaiting approval' : accepted ? 'accepted' : 'rejected'

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline,
        fontSize: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: colors.text.primary }}>
          <span style={{ color: colors.text.muted, marginRight: 6 }}>~</span>
          <strong>{call.args.path}</strong>
        </div>
        <span style={{ fontSize: 11, color: colors.text.muted }}>{status}</span>
      </div>
      <pre
        style={{
          margin: '6px 0 0 0',
          padding: 6,
          maxHeight: 240,
          overflow: 'auto',
          fontSize: 11,
          background: colors.bg.base,
          borderRadius: 4,
          border: `1px solid ${colors.border.subtle}`,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}
      >
        {findLines.slice(0, PREVIEW_LIMIT).map((l, i) => (
          <div key={`f-${i}`}>
            <span style={{ color: 'var(--diff-remove, #f44336)' }}>- </span>
            {l || ' '}
          </div>
        ))}
        {findLines.length > PREVIEW_LIMIT && (
          <div style={{ color: colors.text.muted, marginTop: 4 }}>
            … {findLines.length - PREVIEW_LIMIT} more removed lines
          </div>
        )}
        {replaceLines.slice(0, PREVIEW_LIMIT).map((l, i) => (
          <div key={`r-${i}`}>
            <span style={{ color: 'var(--diff-add, #4caf50)' }}>+ </span>
            {l || ' '}
          </div>
        ))}
        {replaceLines.length > PREVIEW_LIMIT && (
          <div style={{ color: colors.text.muted, marginTop: 4 }}>
            … {replaceLines.length - PREVIEW_LIMIT} more added lines
          </div>
        )}
      </pre>
      {!settled && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            onClick={() => void decide(true)}
            disabled={submitting}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              borderRadius: borderRadius.inline,
              border: `1px solid ${colors.border.default}`,
              background: colors.bg.base,
              color: colors.text.primary,
              cursor: submitting ? 'wait' : 'pointer'
            }}
          >
            Accept
          </button>
          <button
            onClick={() => void decide(false)}
            disabled={submitting}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              borderRadius: borderRadius.inline,
              border: `1px solid ${colors.border.default}`,
              background: 'transparent',
              color: colors.text.muted,
              cursor: submitting ? 'wait' : 'pointer'
            }}
          >
            Reject
          </button>
        </div>
      )}
      {rejected && (
        <div style={{ marginTop: 6, fontSize: 11, color: colors.text.muted }}>
          {result.error.code === 'IO_TRANSIENT' && result.error.message === 'rejected by user'
            ? 'You rejected this edit.'
            : `${result.error.code}: ${result.error.message}${result.error.hint ? ` (${result.error.hint})` : ''}`}
        </div>
      )}
    </div>
  )
}
