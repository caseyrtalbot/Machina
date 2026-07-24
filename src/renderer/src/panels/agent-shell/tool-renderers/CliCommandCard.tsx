import { useMemo, useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { scanSecrets } from '@shared/engine/secrets'
import { segmentOutput, maskSegmentText } from '@shared/engine/block-output-segments'
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
      className="te-tool-cli"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="te-tool-cli-trigger"
        aria-expanded={expanded}
      >
        <span aria-hidden className="te-tool-caret">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="te-tool-cli-cmd">{call.args.command}</span>
        <ExitBadge ok={ok} code={exitCode} />
      </button>
      {expanded && secrets.length > 0 && (
        <div className="te-tool-cli-secrets">
          <span>
            {secrets.length} secret{secrets.length === 1 ? '' : 's'}{' '}
            {revealed ? 'revealed' : 'masked'}
          </span>
          <button
            type="button"
            data-testid="cli-reveal-secrets"
            onClick={() => setRevealed((v) => !v)}
            className="te-tool-cli-reveal"
          >
            {revealed ? 'hide' : 'reveal'}
          </button>
        </div>
      )}
      {expanded && <pre className="te-tool-cli-output">{output || '(no output)'}</pre>}
      {menu}
    </ToolCardShell>
  )
}

function ExitBadge({ ok, code }: { readonly ok: boolean; readonly code: number | null }) {
  const label = code === null ? '…' : `exit ${code}`
  return (
    <span className="te-tool-exit-badge" data-ok={ok ? '' : undefined}>
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
