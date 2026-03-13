import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { MetadataBar } from './MetadataBar'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { colors } from '../../design/tokens'

interface EditorPanelProps {
  onNavigate: (id: string) => void
}

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const { activeNoteId, mode, content, setMode, setContent } = useEditorStore()
  const { getArtifact } = useVaultStore()

  const artifact = activeNoteId ? getArtifact(activeNoteId) : null

  if (!artifact) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: colors.bg.base, color: colors.text.muted }}
      >
        <div className="text-center">
          <p className="text-lg mb-2">No note selected</p>
          <p className="text-sm">Select a note from the sidebar or press Cmd+N to create one</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      <MetadataBar artifact={artifact} onNavigate={onNavigate} />

      <div className="flex-1 overflow-hidden">
        {mode === 'rich' ? (
          <RichEditor content={content} onChange={setContent} />
        ) : (
          <SourceEditor content={content} onChange={setContent} />
        )}
      </div>

      <div
        className="flex items-center gap-2 px-4 py-2 border-t"
        style={{ borderColor: colors.border.default, backgroundColor: colors.bg.surface }}
      >
        <button
          onClick={() => setMode('rich')}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{
            backgroundColor: mode === 'rich' ? colors.accent.muted : 'transparent',
            color: mode === 'rich' ? colors.accent.default : colors.text.muted
          }}
        >
          Rich
        </button>
        <button
          onClick={() => setMode('source')}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{
            backgroundColor: mode === 'source' ? colors.accent.muted : 'transparent',
            color: mode === 'source' ? colors.accent.default : colors.text.muted
          }}
        >
          Source
        </button>
      </div>
    </div>
  )
}
