import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'

type SearchVaultCall = Extract<ToolCall, { kind: 'search_vault' }>

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
  readonly result?: ToolResult
}) {
  if (!result) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 10px',
          borderRadius: borderRadius.inline,
          background: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`,
          fontSize: 12,
          color: colors.text.muted,
          marginTop: 8
        }}
      >
        <span style={{ opacity: 0.6 }}>🔍</span>
        searching for &ldquo;{call.args.query}&rdquo;…
      </div>
    )
  }
  if (!result.ok) return null

  const hits =
    typeof result.output === 'object' && result.output !== null
      ? ((result.output as { hits?: Hit[] }).hits ?? [])
      : []

  function open(rel: string) {
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    useThreadStore.getState().addDockTab({ kind: 'editor', path: `${vault}/${rel}` })
  }

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
      <div style={{ color: colors.text.muted, marginBottom: 6 }}>
        <span style={{ opacity: 0.7, marginRight: 6 }}>🔍</span>
        {hits.length} {hits.length === 1 ? 'hit' : 'hits'} for &ldquo;{call.args.query}&rdquo;
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {hits.slice(0, PREVIEW_LIMIT).map((h, i) => (
          <li
            key={`${h.path}:${h.line}:${i}`}
            style={{
              padding: '4px 0',
              borderBottom:
                i === Math.min(hits.length, PREVIEW_LIMIT) - 1
                  ? 'none'
                  : `1px solid ${colors.border.subtle}`
            }}
          >
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                open(h.path)
              }}
              style={{
                fontSize: 12,
                color: colors.text.primary,
                textDecoration: 'none'
              }}
            >
              {h.path}:{h.line}
            </a>
            <code
              style={{
                display: 'block',
                fontSize: 11,
                color: colors.text.muted,
                marginTop: 2,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {h.snippet}
            </code>
          </li>
        ))}
        {hits.length > PREVIEW_LIMIT && (
          <li style={{ padding: '4px 0', color: colors.text.muted }}>
            … {hits.length - PREVIEW_LIMIT} more
          </li>
        )}
      </ul>
    </div>
  )
}
