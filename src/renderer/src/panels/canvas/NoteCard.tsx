import { useState, useEffect, useMemo, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import { useViewStore } from '../../store/view-store'
import { CardShell } from './CardShell'
import { getCanvasEditorExtensions } from './shared/tiptap-config'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

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

  const extensions = useMemo(() => getCanvasEditorExtensions(), [])

  const editor = useEditor({
    extensions,
    content: '',
    editable: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none px-3 py-2',
        style: `color: ${colors.text.primary}; font-size: 13px;`
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
    const unsub = window.api.on.fileChanged((data) => {
      if (data.path === filePath && data.event === 'change') {
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
    useEditorStore.getState().openTab(filePath, title)
    useViewStore.getState().setContentView('editor')
  }, [filePath, title])

  return (
    <CardShell
      node={node}
      title={title}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
    >
      <div className="h-full overflow-auto" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="p-3">
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Loading...
            </span>
          </div>
        ) : !body ? (
          <div className="p-3">
            <span className="text-sm" style={{ color: colors.text.muted }}>
              Empty note
            </span>
          </div>
        ) : (
          editor && <EditorContent editor={editor} />
        )}
      </div>
    </CardShell>
  )
}

export default NoteCard
