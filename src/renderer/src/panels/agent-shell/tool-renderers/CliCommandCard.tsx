import { useMemo, useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { scanSecrets } from '@shared/engine/secrets'
import { segmentOutput, maskSegmentText } from '@shared/engine/block-output-segments'
import { borderRadius, colors, typography } from '../../../design/tokens'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

type CliCommandCall = Extract<ToolCall, { kind: 'cli_command' }>

export function CliCommandCard({
  call,
  result
}: {
  readonly call: CliCommandCall
  readonly result?: ToolResult
}) {
  const [expanded, setExpanded] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const exitCode = exitCodeFromResult(result)
  const ok = result?.ok === true
  const rawOutput = outputFromResult(result)
  // Same render-time masking as the canvas terminal-block card: agent CLI
  // output (and the error hint, which is a tail of it) can echo secrets.
  const secrets = useMemo(() => scanSecrets(rawOutput), [rawOutput])
  const output =
    revealed || secrets.length === 0
      ? rawOutput
      : segmentOutput(rawOutput, secrets)
          .map((seg) => (seg.secret ? maskSegmentText(seg.text) : seg.text))
          .join('')
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-command',
      label: 'Copy command',
      onSelect: () => void copyText(call.args.command)
    },
    {
      // Copies what is displayed: masked unless the user revealed secrets.
      id: 'copy-output',
      label: 'Copy output',
      disabled: !output,
      onSelect: () => void copyText(output)
    }
  ])

  return (
    <ToolCardShell
      variant="block"
      pending={!result}
      onContextMenu={onContextMenu}
      style={{
        padding: 0,
        fontFamily: typography.fontFamily.mono,
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
          padding: '8px 12px',
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
      {expanded && secrets.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 12px',
            borderTop: `1px solid ${colors.border.subtle}`,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform,
            color: colors.text.muted
          }}
        >
          <span>
            {secrets.length} secret{secrets.length === 1 ? '' : 's'}{' '}
            {revealed ? 'revealed' : 'masked'}
          </span>
          <button
            type="button"
            data-testid="cli-reveal-secrets"
            onClick={() => setRevealed((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: colors.text.secondary,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              letterSpacing: 'inherit',
              textTransform: 'inherit'
            }}
          >
            {revealed ? 'hide' : 'reveal'}
          </button>
        </div>
      )}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            borderTop: `1px solid ${colors.border.subtle}`,
            background: colors.bg.base,
            color: colors.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 360,
            overflow: 'auto',
            fontSize: 11.5,
            lineHeight: 1.55
          }}
        >
          {output || '(no output)'}
        </pre>
      )}
      {menu}
    </ToolCardShell>
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
