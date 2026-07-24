import { useState } from 'react'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { openNoteInEditor } from '../../../store/dock-store'
import { useVaultStore } from '../../../store/vault-store'
import { ToolCardShell } from './ToolCardShell'

type ListVaultCall = Extract<ToolCall, { kind: 'list_vault' }>
type SuccessResult = Extract<ToolResult, { ok: true }>

const PREVIEW_LIMIT = 50

export function ListVaultCard({
  call,
  result
}: {
  readonly call: ListVaultCall
  readonly result?: SuccessResult
}) {
  const [expanded, setExpanded] = useState(false)

  if (!result) {
    return (
      <ToolCardShell variant="pill" inline pending className="te-tool-loading">
        <FolderGlyph />
        <span>listing vault…</span>
      </ToolCardShell>
    )
  }

  const paths =
    typeof result.output === 'object' && result.output !== null
      ? ((result.output as { paths?: string[] }).paths ?? [])
      : []
  const globsLabel =
    call.args.globs && call.args.globs.length > 0 ? call.args.globs.join(', ') : '**/*.md'

  function openInEditor(rel: string) {
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    openNoteInEditor(`${vault}/${rel}`)
  }

  return (
    <ToolCardShell variant="block" className="te-tool-flush">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="te-tool-disclosure"
      >
        <span aria-hidden className="te-tool-caret">
          {expanded ? '▾' : '▸'}
        </span>
        <FolderGlyph />
        <span>
          {paths.length} {paths.length === 1 ? 'file' : 'files'}
        </span>
        <span className="te-tool-mono-muted">· {globsLabel}</span>
      </button>
      {expanded && (
        <ul className="te-tool-list">
          {paths.slice(0, PREVIEW_LIMIT).map((p) => (
            <li key={p} className="te-tool-list-item">
              <a
                href="#"
                className="te-tool-link"
                onClick={(e) => {
                  e.preventDefault()
                  openInEditor(p)
                }}
              >
                {p}
              </a>
            </li>
          ))}
          {paths.length > PREVIEW_LIMIT && (
            <li className="te-tool-list-more">… {paths.length - PREVIEW_LIMIT} more</li>
          )}
        </ul>
      )}
    </ToolCardShell>
  )
}

function FolderGlyph() {
  return (
    <svg aria-hidden width={12} height={11} viewBox="0 0 12 11" className="te-tool-glyph">
      <path
        d="M.5 2.5A1 1 0 0 1 1.5 1.5h3l1.2 1.5h5.3a1 1 0 0 1 1 1V9.5a1 1 0 0 1-1 1H1.5a1 1 0 0 1-1-1v-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </svg>
  )
}
