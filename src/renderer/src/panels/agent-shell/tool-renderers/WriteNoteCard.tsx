import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'

type WriteNoteCall = Extract<ToolCall, { kind: 'write_note' }>

const PREVIEW_LIMIT = 40

export function WriteNoteCard({
  call,
  result
}: {
  readonly call: WriteNoteCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const accepted = settled && result.ok
  const rejected = settled && !result.ok
  const [submitting, setSubmitting] = useState(false)
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-diff',
      label: 'Copy diff',
      onSelect: () =>
        void copyText(
          call.args.content
            .split('\n')
            .map((l) => `+ ${l}`)
            .join('\n')
        )
    },
    {
      id: 'copy-content',
      label: 'Copy content',
      onSelect: () => void copyText(call.args.content)
    },
    {
      id: 'copy-path',
      label: 'Copy path',
      onSelect: () => void copyText(call.args.path)
    }
  ])

  async function decide(accept: boolean) {
    if (settled || submitting) return
    setSubmitting(true)
    try {
      await window.api.agentNative.toolDecision({ toolUseId: call.id, accept })
    } finally {
      setSubmitting(false)
    }
  }

  const lines = call.args.content.split('\n')
  const status = !settled ? 'awaiting approval' : accepted ? 'accepted' : 'rejected'

  return (
    <div
      onContextMenu={onContextMenu}
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
          <span style={{ color: 'var(--diff-add, #4caf50)', marginRight: 6 }}>+</span>
          <strong>{call.args.path}</strong>
        </div>
        <span style={{ fontSize: 11, color: colors.text.muted }}>{status}</span>
      </div>
      <pre
        style={{
          margin: '6px 0 0 0',
          padding: 6,
          maxHeight: 200,
          overflow: 'auto',
          fontSize: 11,
          background: colors.bg.base,
          borderRadius: 4,
          border: `1px solid ${colors.border.subtle}`,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}
      >
        {lines.slice(0, PREVIEW_LIMIT).map((l, i) => (
          <div key={i}>
            <span style={{ color: 'var(--diff-add, #4caf50)' }}>+ </span>
            {l || ' '}
          </div>
        ))}
        {lines.length > PREVIEW_LIMIT && (
          <div style={{ color: colors.text.muted, marginTop: 4 }}>
            … {lines.length - PREVIEW_LIMIT} more lines
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
            ? 'You rejected this write.'
            : `${result.error.code}: ${result.error.message}`}
        </div>
      )}
      {menu}
    </div>
  )
}
