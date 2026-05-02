import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { borderRadius, colors } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'

type CliCommandCall = Extract<ToolCall, { kind: 'cli_command' }>

export function CliCommandCard({
  call,
  result
}: {
  readonly call: CliCommandCall
  readonly result?: ToolResult
}) {
  const [expanded, setExpanded] = useState(false)
  const exitCode = exitCodeFromResult(result)
  const ok = result?.ok === true
  const output = outputFromResult(result)
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-command',
      label: 'Copy command',
      onSelect: () => void copyText(call.args.command)
    },
    {
      id: 'copy-output',
      label: 'Copy output',
      disabled: !output,
      onSelect: () => void copyText(output)
    }
  ])

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        marginTop: 8,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.container,
        background: colors.bg.elevated,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        overflow: 'hidden'
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          color: colors.text.primary,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit'
        }}
        aria-expanded={expanded}
      >
        <span aria-hidden style={{ opacity: 0.5, width: 10 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {call.args.command}
        </span>
        <ExitBadge ok={ok} code={exitCode} />
      </button>
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            borderTop: `1px solid ${colors.border.subtle}`,
            color: colors.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 360,
            overflow: 'auto'
          }}
        >
          {output || '(no output)'}
        </pre>
      )}
      {menu}
    </div>
  )
}

function ExitBadge({ ok, code }: { readonly ok: boolean; readonly code: number | null }) {
  const bg = ok ? colors.claude.ready : colors.claude.error
  const label = code === null ? '…' : `exit ${code}`
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: borderRadius.inline,
        background: `color-mix(in srgb, ${bg} 18%, transparent)`,
        color: bg,
        fontSize: 11,
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </span>
  )
}

function exitCodeFromResult(result: ToolResult | undefined): number | null {
  if (!result) return null
  if (result.ok && typeof result.output === 'object' && result.output !== null) {
    const out = result.output as { exitCode?: number }
    return typeof out.exitCode === 'number' ? out.exitCode : 0
  }
  if (!result.ok) {
    const m = /exit\s+(-?\d+)/.exec(result.error.message)
    return m ? parseInt(m[1], 10) : -1
  }
  return null
}

function outputFromResult(result: ToolResult | undefined): string {
  if (!result) return ''
  if (result.ok && typeof result.output === 'object' && result.output !== null) {
    return (result.output as { output?: string }).output ?? ''
  }
  if (!result.ok) {
    return result.error.hint ?? result.error.message
  }
  return ''
}
