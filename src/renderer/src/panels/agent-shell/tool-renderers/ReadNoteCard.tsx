import type { ToolCall, ToolResult } from '@shared/thread-types'
import { colors, borderRadius } from '../../../design/tokens'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { copyText, useToolCardMenu } from './useToolCardMenu'

type ReadNoteCall = Extract<ToolCall, { kind: 'read_note' }>

export function ReadNoteCard({
  call,
  result
}: {
  readonly call: ReadNoteCall
  readonly result?: ToolResult
}) {
  const lines =
    result && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { lines?: string }).lines ?? '')
      : ''
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-path',
      label: 'Copy path',
      onSelect: () => void copyText(call.args.path)
    }
  ])

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    const fullPath = call.args.path.startsWith('/') ? call.args.path : `${vault}/${call.args.path}`
    useThreadStore.getState().addDockTab({ kind: 'editor', path: fullPath })
  }

  return (
    <>
      <a
        href="#"
        onClick={handleClick}
        onContextMenu={onContextMenu}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 10px',
          borderRadius: borderRadius.inline,
          background: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`,
          fontSize: 12,
          color: colors.text.primary,
          textDecoration: 'none',
          marginTop: 8,
          cursor: 'pointer'
        }}
      >
        <span style={{ opacity: 0.6 }}>📄</span>
        {call.args.path}
        {lines && <span style={{ opacity: 0.6 }}>· {lines}</span>}
      </a>
      {menu}
    </>
  )
}
