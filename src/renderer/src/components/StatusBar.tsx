import { useVaultStore } from '../store/vault-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'
import { colors } from '../design/tokens'

interface EditorStatusProps {
  content: string
  cursorLine: number
  cursorCol: number
}

function EditorStatus({ content, cursorLine, cursorCol }: EditorStatusProps) {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  return (
    <>
      <span>
        Ln {cursorLine}, Col {cursorCol}
      </span>
      <span className="mx-2">&middot;</span>
      <span>{wordCount} words</span>
      <span className="mx-2">&middot;</span>
      <span>UTF-8</span>
    </>
  )
}

export function StatusBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const fileCount = useVaultStore((s) => s.files.length)

  const content = useEditorStore((s) => s.content)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const cursorCol = useEditorStore((s) => s.cursorCol)

  const contentView = useViewStore((s) => s.contentView)

  const vaultName = vaultPath?.split('/').pop() ?? 'Machina'

  return (
    <div
      className="h-6 flex items-center px-3 text-[11px] flex-shrink-0"
      style={{
        backgroundColor: colors.bg.base,
        color: colors.text.muted
      }}
    >
      <div className="flex items-center flex-1">
        <span>{vaultName}</span>
        <span className="mx-2">&middot;</span>
        <span>
          {fileCount} {fileCount === 1 ? 'note' : 'notes'}
        </span>
      </div>
      <div className="flex items-center">
        {contentView === 'editor' && (
          <EditorStatus content={content} cursorLine={cursorLine} cursorCol={cursorCol} />
        )}
      </div>
    </div>
  )
}
