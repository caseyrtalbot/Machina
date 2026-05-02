import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, typography } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { ToolCardShell } from './ToolCardShell'

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
      <ToolCardShell variant="pill" inline style={{ gap: 6, color: colors.text.muted }}>
        <FolderGlyph />
        <span>listing vault…</span>
      </ToolCardShell>
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
    <ToolCardShell variant="block" style={{ padding: 0 }}>
      <details>
        <summary
          style={{
            cursor: 'pointer',
            color: colors.text.primary,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <FolderGlyph />
          <span>
            {paths.length} {paths.length === 1 ? 'file' : 'files'}
          </span>
          <span style={{ color: colors.text.muted, fontFamily: typography.fontFamily.mono }}>
            · {globsLabel}
          </span>
        </summary>
        <ul
          style={{
            margin: 0,
            padding: '6px 12px 10px 24px',
            listStyle: 'none',
            borderTop: `1px solid ${colors.border.subtle}`
          }}
        >
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
                  fontSize: 12,
                  fontFamily: typography.fontFamily.mono
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
    </ToolCardShell>
  )
}

function FolderGlyph() {
  return (
    <svg
      aria-hidden
      width={12}
      height={11}
      viewBox="0 0 12 11"
      style={{ flexShrink: 0, opacity: 0.7 }}
    >
      <path
        d="M.5 2.5A1 1 0 0 1 1.5 1.5h3l1.2 1.5h5.3a1 1 0 0 1 1 1V9.5a1 1 0 0 1-1 1H1.5a1 1 0 0 1-1-1v-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </svg>
  )
}
