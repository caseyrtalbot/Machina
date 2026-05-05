import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius, typography } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

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
    <ToolCardShell variant="block" onContextMenu={onContextMenu}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: colors.text.primary, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: colors.diff.added, fontFamily: typography.fontFamily.mono }}>
            +
          </span>
          <strong>{call.args.path}</strong>
        </div>
        <span
          style={{
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform,
            color: colors.text.muted
          }}
        >
          {status}
        </span>
      </div>
      <pre
        style={{
          margin: '8px 0 0 0',
          padding: '8px 10px',
          maxHeight: 220,
          overflow: 'auto',
          fontSize: 11.5,
          lineHeight: 1.55,
          background: colors.bg.base,
          borderRadius: borderRadius.inline,
          border: `0.5px solid ${colors.border.subtle}`,
          fontFamily: typography.fontFamily.mono
        }}
      >
        {lines.slice(0, PREVIEW_LIMIT).map((l, i) => (
          <div
            key={i}
            style={{
              background: colors.diff.addedBg,
              color: colors.text.primary,
              padding: '0 4px'
            }}
          >
            <span style={{ color: colors.diff.added, marginRight: 6 }}>+</span>
            {l || ' '}
          </div>
        ))}
        {lines.length > PREVIEW_LIMIT && (
          <div style={{ color: colors.text.muted, marginTop: 4, padding: '0 4px' }}>
            … {lines.length - PREVIEW_LIMIT} more lines
          </div>
        )}
      </pre>
      {!settled && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            onClick={() => void decide(true)}
            disabled={submitting}
            style={{
              padding: '5px 14px',
              fontSize: 12,
              borderRadius: borderRadius.inline,
              border: `0.5px solid ${colors.accent.default}`,
              background: 'color-mix(in srgb, var(--color-accent-default) 14%, transparent)',
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
              padding: '5px 14px',
              fontSize: 12,
              borderRadius: borderRadius.inline,
              border: `0.5px solid ${colors.border.default}`,
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
        <div style={{ marginTop: 8, fontSize: 11, color: colors.text.muted }}>
          {result.error.code === 'IO_TRANSIENT' && result.error.message === 'rejected by user'
            ? 'You rejected this write.'
            : `${result.error.code}: ${result.error.message}`}
        </div>
      )}
      {menu}
    </ToolCardShell>
  )
}
