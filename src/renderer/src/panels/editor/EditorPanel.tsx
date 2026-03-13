import { useEffect, useMemo, useCallback } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorToolbar } from './EditorToolbar'
import { EditorBreadcrumb, useNavigationHistory } from './EditorBreadcrumb'
import { FrontmatterHeader } from './FrontmatterHeader'
import { BacklinksPanel } from './BacklinksPanel'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { colors } from '../../design/tokens'

interface EditorPanelProps {
  onNavigate: (id: string) => void
}

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const activeNoteId = useEditorStore((s) => s.activeNoteId)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const mode = useEditorStore((s) => s.mode)
  const content = useEditorStore((s) => s.content)
  const setMode = useEditorStore((s) => s.setMode)
  const setContent = useEditorStore((s) => s.setContent)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifact = useVaultStore((s) =>
    activeNoteId ? s.artifacts.find((a) => a.id === activeNoteId) ?? null : null
  )
  const getBacklinks = useVaultStore((s) => s.getBacklinks)

  const backlinks = useMemo(
    () => (activeNoteId ? getBacklinks(activeNoteId) : []),
    [activeNoteId, getBacklinks]
  )

  const { canGoBack, canGoForward, push, goBack, goForward } = useNavigationHistory()

  // Push to navigation history when active note changes
  useEffect(() => {
    if (activeNotePath) {
      push(activeNotePath)
    }
  }, [activeNotePath, push])

  // Build Tiptap extensions
  const extensions = useMemo(
    () => [
      StarterKit,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
    ],
    []
  )

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markdown = (ed as any).getMarkdown?.()
      if (typeof markdown === 'string') {
        setContent(markdown)
      }
    },
    [setContent]
  )

  const handleSelectionUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      const { from } = ed.state.selection
      const resolved = ed.state.doc.resolve(from)
      // Approximate line/col from the document position
      const lineBlock = resolved.node(1)
      const lineText = lineBlock ? lineBlock.textContent : ''
      const offset = from - resolved.start(1)
      // Use 1-based indexing for display
      const lineNumber = resolved.depth > 0 ? resolved.index(0) + 1 : 1
      const colNumber = Math.max(1, offset + 1)
      setCursorPosition(lineNumber, Math.min(colNumber, lineText.length + 1))
    },
    [setCursorPosition]
  )

  const editor = useEditor({
    extensions,
    content,
    onUpdate: handleUpdate,
    onSelectionUpdate: handleSelectionUpdate,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full px-8 py-6',
        style: `color: ${colors.text.primary}; font-family: Inter, system-ui, sans-serif;`,
      },
    },
  })

  // Sync external content changes into the editor
  useEffect(() => {
    if (!editor) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentMarkdown = (editor as any).getMarkdown?.()
    if (typeof currentMarkdown === 'string' && content !== currentMarkdown) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  const handleToggleMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

  // Empty state
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

  const filePath = activeNotePath ?? ''
  const resolvedVaultPath = vaultPath ?? ''

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      <EditorBreadcrumb
        filePath={filePath}
        vaultPath={resolvedVaultPath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={goBack}
        onGoForward={goForward}
      />

      <EditorToolbar
        editor={editor}
        mode={mode}
        onToggleMode={handleToggleMode}
      />

      <FrontmatterHeader
        artifact={artifact}
        mode={mode}
        onNavigate={onNavigate}
      />

      <div className="flex-1 overflow-hidden">
        {mode === 'rich' ? (
          <RichEditor editor={editor} />
        ) : (
          <SourceEditor content={content} onChange={setContent} />
        )}
      </div>

      <BacklinksPanel
        currentNoteId={activeNoteId ?? ''}
        backlinks={backlinks}
        onNavigate={onNavigate}
      />
    </div>
  )
}
