import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

type ReadNoteCall = Extract<ToolCall, { kind: 'read_note' }>

export function ReadNoteCard({
  call,
  result
}: {
  readonly call: ReadNoteCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const lines =
    settled && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { lines?: string }).lines ?? '')
      : ''
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-path',
      label: 'Copy path',
      onSelect: () => void copyText(call.args.path)
    }
  ])

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!settled) return
    e.preventDefault()
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    const fullPath = call.args.path.startsWith('/') ? call.args.path : `${vault}/${call.args.path}`
    useThreadStore.getState().openOrFocusDockTab({ kind: 'editor', path: fullPath })
  }

  return (
    <>
      <ToolCardShell
        variant="pill"
        inline
        onContextMenu={onContextMenu}
        style={{ cursor: settled ? 'pointer' : 'default', gap: 6 }}
      >
        <div
          role="button"
          tabIndex={settled ? 0 : -1}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (!settled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleClick(e as unknown as React.MouseEvent<HTMLDivElement>)
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: settled ? colors.text.primary : colors.text.muted
          }}
        >
          <FileGlyph />
          <span>{call.args.path}</span>
          {!settled ? (
            <span style={{ color: colors.text.muted }}>· reading…</span>
          ) : (
            lines && <span style={{ color: colors.text.muted }}>· {lines}</span>
          )}
        </div>
      </ToolCardShell>
      {menu}
    </>
  )
}

function FileGlyph() {
  return (
    <svg
      aria-hidden
      width={11}
      height={13}
      viewBox="0 0 11 13"
      style={{ flexShrink: 0, opacity: 0.65 }}
    >
      <path
        d="M1 1.5A1 1 0 0 1 2 .5h4.5L10 4v7.5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <path d="M6.5 .5V4H10" fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  )
}
