import { useState, useEffect, useMemo, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { CardShell } from './CardShell'
import { getCanvasEditorExtensions } from './shared/tiptap-config'
import { CardBadge } from './shared/CardBadge'
import { MetadataGrid } from './shared/MetadataGrid'
import { frontmatterToEntries } from './shared/frontmatter-utils'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { vaultEvents } from '@engine/vault-event-hub'

interface NoteCardProps {
  node: CanvasNode
}

export function NoteCard({ node }: NoteCardProps) {
  const [body, setBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)

  // The node.content holds the vault file path
  const filePath = node.content
  const artifactId = fileToId[filePath]
  const artifact = artifacts.find((a) => a.id === artifactId)
  const title = artifact?.title ?? filePath.split('/').pop()?.replace('.md', '') ?? 'Note'

  // Build metadata entries from artifact frontmatter (single source of truth)
  const metadataEntries = useMemo(
    () => (artifact ? frontmatterToEntries(artifact.frontmatter) : []),
    [artifact]
  )

  // Display type badge from artifact type
  const badgeLabel = artifact?.type?.toUpperCase() ?? 'NOTE'

  const extensions = useMemo(() => getCanvasEditorExtensions(), [])

  const editor = useEditor({
    extensions,
    content: '',
    editable: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none'
      }
    }
  })

  // Load file content
  useEffect(() => {
    if (!filePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early exit when no file to load
      setLoading(false)
      return
    }
    setLoading(true)
    window.api.fs
      .readFile(filePath)
      .then((content: string) => {
        // Strip frontmatter for display
        const fmEnd = content.indexOf('---', content.indexOf('---') + 3)
        const bodyStart = fmEnd > 0 ? fmEnd + 3 : 0
        setBody(content.slice(bodyStart).trim())
        setLoading(false)
      })
      .catch(() => {
        setBody('Failed to load note')
        setLoading(false)
      })
  }, [filePath])

  // Re-read on vault file changes (reactive)
  useEffect(() => {
    const unsub = vaultEvents.subscribePath(filePath, (data) => {
      if (data.event === 'change') {
        window.api.fs
          .readFile(filePath)
          .then((content: string) => {
            const fmEnd = content.indexOf('---', content.indexOf('---') + 3)
            const bodyStart = fmEnd > 0 ? fmEnd + 3 : 0
            setBody(content.slice(bodyStart).trim())
          })
          .catch(() => {})
      }
    })
    return () => {
      unsub()
    }
  }, [filePath])

  // Sync body into Tiptap editor for rich rendering
  useEffect(() => {
    if (!editor || !body || loading) return
    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(body)
      editor.commands.setContent(json)
    } else {
      editor.commands.setContent(body)
    }
  }, [editor, body, loading])

  const openInEditor = useCallback(() => {
    useCanvasStore.getState().openSplit(filePath)
  }, [filePath])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      useCanvasStore.getState().setCardContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId: node.id
      })
    },
    [node.id]
  )

  return (
    <CardShell
      node={node}
      title={title}
      filePath={filePath}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
      onContextMenu={handleContextMenu}
    >
      <div className="h-full overflow-auto canvas-card-content" style={{ minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: 28 }}>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Loading...
            </span>
          </div>
        ) : !body ? (
          <div style={{ padding: 28 }}>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Empty note
            </span>
          </div>
        ) : (
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{ marginBottom: 20 }}>
              <CardBadge label={badgeLabel} />
            </div>

            {metadataEntries.length > 0 && <MetadataGrid entries={metadataEntries} />}

            <div className="canvas-prose">{editor && <EditorContent editor={editor} />}</div>
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default NoteCard
