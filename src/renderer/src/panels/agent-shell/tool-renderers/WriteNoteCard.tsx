import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

type WriteNoteCall = Extract<ToolCall, { kind: 'write_note' }>

const PREVIEW_LIMIT = 40

export function WriteNoteCard({
  call,
  result,
  historical
}: {
  readonly call: WriteNoteCall
  readonly result?: ToolResult
  /** Finalized message: a result-less call can never settle — no approval UI. */
  readonly historical?: boolean
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
  const status = !settled
    ? historical
      ? 'not run'
      : 'awaiting approval'
    : accepted
      ? 'accepted'
      : 'rejected'

  return (
    <ToolCardShell variant="block" onContextMenu={onContextMenu}>
      <div className="te-tool-note-head">
        <div className="te-tool-note-title">
          <span className="te-tool-note-sigil" data-add="">
            +
          </span>
          <strong>{call.args.path}</strong>
        </div>
        <span className="te-tool-meta">{status}</span>
      </div>
      <pre className="te-tool-diff te-tool-diff--write">
        {lines.slice(0, PREVIEW_LIMIT).map((l, i) => (
          <div key={i} className="te-tool-diff-line--add">
            <span className="te-tool-diff-sign--add">+</span>
            {l || ' '}
          </div>
        ))}
        {lines.length > PREVIEW_LIMIT && (
          <div className="te-tool-diff-more">… {lines.length - PREVIEW_LIMIT} more lines</div>
        )}
      </pre>
      {!settled && !historical && (
        <div className="te-tool-actions te-tool-actions--write">
          <button
            onClick={() => void decide(true)}
            disabled={submitting}
            className="te-tool-btn te-tool-btn--accept"
          >
            Accept
          </button>
          <button
            onClick={() => void decide(false)}
            disabled={submitting}
            className="te-tool-btn te-tool-btn--reject"
          >
            Reject
          </button>
        </div>
      )}
      {rejected && (
        <div className="te-tool-reject-note">
          {result.error.code === 'IO_TRANSIENT' && result.error.message === 'rejected by user'
            ? 'You rejected this write.'
            : `${result.error.code}: ${result.error.message}`}
        </div>
      )}
      {menu}
    </ToolCardShell>
  )
}
