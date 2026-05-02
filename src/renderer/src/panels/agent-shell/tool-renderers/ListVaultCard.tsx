import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'

type ListVaultCall = Extract<ToolCall, { kind: 'list_vault' }>

const PREVIEW_LIMIT = 50

export function ListVaultCard({
  call,
  result
}: {
  readonly call: ListVaultCall
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
        <span style={{ opacity: 0.6 }}>📁</span>
        listing vault…
      </div>
    )
  }
  if (!result.ok) return null

  const paths =
    typeof result.output === 'object' && result.output !== null
      ? ((result.output as { paths?: string[] }).paths ?? [])
      : []
  const globsLabel =
    call.args.globs && call.args.globs.length > 0 ? call.args.globs.join(', ') : '**/*.md'

  function openInEditor(rel: string) {
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    useThreadStore.getState().addDockTab({ kind: 'editor', path: `${vault}/${rel}` })
  }

  return (
    <details
      style={{
        marginTop: 8,
        padding: 8,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline,
        fontSize: 12
      }}
    >
      <summary style={{ cursor: 'pointer', color: colors.text.primary }}>
        <span style={{ opacity: 0.6, marginRight: 6 }}>📁</span>
        {paths.length} {paths.length === 1 ? 'file' : 'files'}
        <span style={{ marginLeft: 6, opacity: 0.5 }}>· {globsLabel}</span>
      </summary>
      <ul style={{ margin: '6px 0 0 0', padding: 0, listStyle: 'none' }}>
        {paths.slice(0, PREVIEW_LIMIT).map((p) => (
          <li key={p} style={{ padding: '2px 0' }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                openInEditor(p)
              }}
              style={{
                color: colors.text.primary,
                textDecoration: 'none',
                fontSize: 12
              }}
            >
              {p}
            </a>
          </li>
        ))}
        {paths.length > PREVIEW_LIMIT && (
          <li style={{ padding: '2px 0', color: colors.text.muted }}>
            … {paths.length - PREVIEW_LIMIT} more
          </li>
        )}
      </ul>
    </details>
  )
}
