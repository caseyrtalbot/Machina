import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, typography } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { ToolCardShell } from './ToolCardShell'

type SearchVaultCall = Extract<ToolCall, { kind: 'search_vault' }>
type SuccessResult = Extract<ToolResult, { ok: true }>

interface Hit {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

const PREVIEW_LIMIT = 10

export function SearchVaultCard({
  call,
  result
}: {
  readonly call: SearchVaultCall
  readonly result?: SuccessResult
}) {
  if (!result) {
    return (
      <ToolCardShell variant="pill" inline pending style={{ gap: 6, color: colors.text.muted }}>
        <SearchGlyph />
        <span>searching for &ldquo;{call.args.query}&rdquo;…</span>
      </ToolCardShell>
    )
  }

  const output =
    typeof result.output === 'object' && result.output !== null
      ? (result.output as { hits?: Hit[]; truncated?: boolean; engine?: string })
      : {}
  const hits = output.hits ?? []
  const truncated = output.truncated === true

  function open(rel: string) {
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    useThreadStore.getState().openOrFocusDockTab({ kind: 'editor', path: `${vault}/${rel}` })
  }

  return (
    <ToolCardShell variant="block">
      <div
        style={{
          color: colors.text.muted,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform
        }}
      >
        <SearchGlyph />
        <span>
          {hits.length}
          {truncated ? '+' : ''} {hits.length === 1 ? 'hit' : 'hits'} for &ldquo;
          {call.args.query}&rdquo;
          {truncated ? ' — capped, narrow the query for more' : ''}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {hits.slice(0, PREVIEW_LIMIT).map((h, i) => (
          <li
            key={`${h.path}:${h.line}:${i}`}
            style={{
              padding: '5px 0',
              borderBottom:
                i === Math.min(hits.length, PREVIEW_LIMIT) - 1
                  ? 'none'
                  : `0.5px solid ${colors.border.subtle}`
            }}
          >
            <a
              href="#"
              className="no-underline hover:underline"
              onClick={(e) => {
                e.preventDefault()
                open(h.path)
              }}
              style={{
                fontSize: 12,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.primary
              }}
            >
              {h.path}:{h.line}
            </a>
            <code
              style={{
                display: 'block',
                fontSize: 11,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.muted,
                marginTop: 3,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {h.snippet}
            </code>
          </li>
        ))}
        {hits.length > PREVIEW_LIMIT && (
          <li style={{ padding: '5px 0', color: colors.text.muted }}>
            … {hits.length - PREVIEW_LIMIT} more
          </li>
        )}
      </ul>
    </ToolCardShell>
  )
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden
      width={11}
      height={11}
      viewBox="0 0 11 11"
      style={{ flexShrink: 0, opacity: 0.7 }}
    >
      <circle cx={4.5} cy={4.5} r={3.5} fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M7.5 7.5 L10 10" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
    </svg>
  )
}
