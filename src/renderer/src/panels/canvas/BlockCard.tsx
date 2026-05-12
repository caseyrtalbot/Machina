import { memo, useMemo, useState } from 'react'
import { CardShell } from './CardShell'
import { useCanvasStore } from '../../store/canvas-store'
import { useBlockStore } from '../../store/block-store'
import { colors, typography } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import type { Block, BlockState, SecretRef } from '@shared/engine/block-model'
import { segmentOutput, maskSegmentText } from '@shared/engine/block-output-segments'
import {
  stripTerminalControls,
  extractCommand,
  dropPromptHeader
} from '@shared/engine/terminal-text'
import { scanSecrets } from '@shared/engine/secrets'
import { formatElapsed } from '@shared/format-elapsed'

interface BlockCardProps {
  readonly node: CanvasNode
}

type ResolvedState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'running'; readonly startedAt: number }
  | {
      readonly kind: 'completed'
      readonly startedAt: number
      readonly finishedAt: number
      readonly exitCode: number
    }
  | { readonly kind: 'cancelled'; readonly startedAt: number; readonly finishedAt: number }
  | {
      readonly kind: 'archived'
      readonly startedAtMs: number | null
      readonly finishedAtMs: number | null
      readonly exitCode: number | null
    }

interface ResolvedBlock {
  readonly command: string
  readonly cwd: string | null
  readonly outputText: string
  readonly secrets: readonly SecretRef[]
  readonly state: ResolvedState
}

function resolveFromBlock(block: Block): ResolvedBlock {
  // Block.outputText accumulates raw PTY bytes including ANSI/OSC noise and
  // the prompt-redraw bytes that fire between prompt-start and command-start.
  // Strip control sequences, then peel the prompt header off for display.
  const cleaned = stripTerminalControls(block.outputText)
  const cmdFromOutput = extractCommand(cleaned)
  const outputText = dropPromptHeader(cleaned)
  // Re-scan secrets on the displayed text so offsets align with what the user
  // sees. If the cleaned text is unchanged, reuse the engine's scan verbatim.
  const secrets =
    outputText === block.outputText
      ? block.secrets
      : scanSecrets(outputText).map((s) => ({ start: s.start, end: s.end, kind: s.kind }))
  return {
    command: block.command || cmdFromOutput,
    cwd: block.metadata.cwd,
    outputText,
    secrets,
    state: block.state as ResolvedState
  }
}

function resolveFromMetadata(meta: Readonly<Record<string, unknown>>): ResolvedBlock {
  return {
    command: (meta.command as string | undefined) ?? '',
    cwd: (meta.cwd as string | null | undefined) ?? null,
    outputText: '',
    secrets: [],
    state: {
      kind: 'archived',
      startedAtMs: (meta.startedAtMs as number | null | undefined) ?? null,
      finishedAtMs: (meta.finishedAtMs as number | null | undefined) ?? null,
      exitCode: (meta.exitCode as number | null | undefined) ?? null
    }
  }
}

const STATUS_COLOR: Record<string, string> = {
  running: colors.claude.warning,
  completed: colors.claude.ready,
  cancelled: colors.claude.error,
  pending: colors.text.muted,
  archived: colors.text.muted
}

function statusLabel(state: ResolvedState): string {
  switch (state.kind) {
    case 'running':
      return 'running'
    case 'completed':
      return `exit ${state.exitCode}`
    case 'cancelled':
      return 'cancelled'
    case 'pending':
      return 'pending'
    case 'archived':
      return state.exitCode == null ? 'archived' : `exit ${state.exitCode}`
  }
}

function exitOk(state: ResolvedState): boolean | undefined {
  if (state.kind === 'completed') return state.exitCode === 0
  if (state.kind === 'archived' && state.exitCode != null) return state.exitCode === 0
  return undefined
}

function renderOutput(
  text: string,
  secrets: readonly SecretRef[],
  revealed: boolean
): React.ReactNode {
  if (text.length === 0) return ''
  if (secrets.length === 0) return text
  const segments = segmentOutput(text, secrets)
  return segments.map((seg, i) => {
    if (!seg.secret) return <span key={i}>{seg.text}</span>
    if (revealed) {
      return (
        <span
          key={i}
          data-testid="block-secret"
          data-secret-kind={seg.secret.kind}
          data-revealed="true"
          style={{
            background: 'color-mix(in srgb, currentColor 8%, transparent)',
            borderRadius: 2,
            padding: '0 2px'
          }}
          title={`${seg.secret.kind} (revealed)`}
        >
          {seg.text}
        </span>
      )
    }
    return (
      <span
        key={i}
        data-testid="block-secret"
        data-secret-kind={seg.secret.kind}
        data-revealed="false"
        style={{
          background: 'color-mix(in srgb, currentColor 12%, transparent)',
          borderRadius: 2,
          padding: '0 2px',
          letterSpacing: '0.04em'
        }}
        title={`${seg.secret.kind} (hidden — click reveal to show)`}
      >
        {maskSegmentText(seg.text)}
      </span>
    )
  })
}

function elapsedFor(state: BlockState | ResolvedState, now: number): string | null {
  if (state.kind === 'pending' || state.kind === 'archived') return null
  if (state.kind === 'running') return formatElapsed(now - state.startedAt)
  return formatElapsed(state.finishedAt - state.startedAt)
}

function BlockCardInner({ node }: BlockCardProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const sessionId = (node.metadata?.sessionId as string | undefined) ?? ''
  const blockId = (node.metadata?.blockId as string | undefined) ?? ''

  const liveBlock = useBlockStore((s) => {
    const list = s.blocksBySession[sessionId]
    return list?.find((b) => b.id === blockId)
  })

  const [revealed, setRevealed] = useState(false)
  const [now] = useState(() => Date.now())

  const resolved = useMemo(
    () => (liveBlock ? resolveFromBlock(liveBlock) : resolveFromMetadata(node.metadata)),
    [liveBlock, node.metadata]
  )

  const stateKind = resolved.state.kind
  const statusColor = STATUS_COLOR[stateKind] ?? colors.text.muted
  const ok = exitOk(resolved.state)
  const elapsed = elapsedFor(resolved.state, now)
  const cwdShort = resolved.cwd
    ? (resolved.cwd.split('/').filter(Boolean).pop() ?? resolved.cwd)
    : null
  const title = resolved.command.trim() || '(no command)'

  const titleExtra = (
    <span
      data-testid="block-status"
      data-state={stateKind}
      {...(ok !== undefined ? { 'data-exit-ok': String(ok) } : {})}
      style={{
        fontSize: 10,
        fontFamily: typography.fontFamily.mono,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: statusColor,
        border: `1px solid ${statusColor}`,
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap'
      }}
    >
      {stateKind === 'running' ? (
        <span data-testid="block-spinner" style={{ marginRight: 4 }}>
          ⟳
        </span>
      ) : null}
      {statusLabel(resolved.state)}
    </span>
  )

  return (
    <CardShell
      node={node}
      title={title}
      titleExtra={titleExtra}
      onClose={() => removeNode(node.id)}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 0, height: '100%' }}>
        <div className="flex items-center justify-between">
          {cwdShort ? (
            <span
              data-testid="block-cwd"
              title={resolved.cwd ?? undefined}
              style={{
                fontSize: 11,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {cwdShort}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {elapsed ? (
              <span
                data-testid="block-elapsed"
                style={{
                  fontSize: 11,
                  fontFamily: typography.fontFamily.mono,
                  color: colors.text.muted
                }}
              >
                {elapsed}
              </span>
            ) : null}
            {resolved.secrets.length > 0 ? (
              <button
                type="button"
                data-testid="block-reveal-toggle"
                data-revealed={String(revealed)}
                onClick={() => setRevealed((v) => !v)}
                style={{
                  fontSize: 10,
                  fontFamily: typography.fontFamily.mono,
                  color: revealed ? colors.claude.warning : colors.text.muted,
                  border: `1px solid ${revealed ? colors.claude.warning : colors.border.default}`,
                  borderRadius: 4,
                  padding: '1px 6px',
                  background: 'transparent',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em'
                }}
              >
                {revealed ? 'hide' : `reveal (${resolved.secrets.length})`}
              </button>
            ) : null}
          </div>
        </div>

        <pre
          data-testid="block-output"
          data-secrets={String(resolved.secrets.length)}
          data-revealed={String(revealed)}
          style={{
            margin: 0,
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            fontSize: 11,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {renderOutput(resolved.outputText, resolved.secrets, revealed) ||
            (stateKind === 'running' ? '…' : '')}
        </pre>
      </div>
    </CardShell>
  )
}

const BlockCard = memo(BlockCardInner)
export default BlockCard
