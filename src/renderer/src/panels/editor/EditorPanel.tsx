import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { FrontmatterHeader } from './FrontmatterHeader'
import { BacklinksPanel } from './BacklinksPanel'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { CodeFileEditor } from './CodeFileEditor'
import { parseFrontmatter } from './markdown-utils'
import { ConceptNodeMark } from './extensions/concept-node-mark'
import { MermaidCodeBlock } from './extensions/mermaid-code-block'
import { SlashCommand } from './extensions/slash-command'
import { CalloutBlock } from './extensions/callout-block'
import { HighlightMark } from './extensions/highlight-mark'
import { WikilinkNode } from './extensions/wikilink-node'
import DragHandle from '@tiptap/extension-drag-handle'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { EditorContextMenu, type ContextMenuAction } from './EditorContextMenu'
import { colors } from '../../design/tokens'
import { useDocument } from '../../hooks/useDocument'

interface EditorPanelProps {
  onNavigate: (id: string) => void
}

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const activeNoteId = useEditorStore((s) => s.activeNoteId)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const mode = useEditorStore((s) => s.mode)
  const content = useEditorStore((s) => s.content)
  const setContent = useEditorStore((s) => s.setContent)
  const loadContent = useEditorStore((s) => s.loadContent)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  // DocumentManager: all file I/O goes through main process
  const doc = useDocument(activeNotePath)

  const artifact = useVaultStore((s) =>
    activeNoteId ? (s.artifacts.find((a) => a.id === activeNoteId) ?? null) : null
  )
  const getBacklinks = useVaultStore((s) => s.getBacklinks)

  const backlinks = useMemo(
    () => (activeNoteId ? getBacklinks(activeNoteId) : []),
    [activeNoteId, getBacklinks]
  )

  // Track which path we last loaded from disk
  const prevLoadedPathRef = useRef<string | null>(null)

  // Frontmatter: raw string preserved for lossless round-tripping (ref),
  // parsed data stored as state so changes trigger re-render for the properties panel
  const frontmatterRawRef = useRef('')
  const [frontmatterData, setFrontmatterData] = useState<
    Readonly<Record<string, string | readonly string[]>>
  >({})

  // Context menu state for concept node linking
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    actions: ContextMenuAction[]
  } | null>(null)

  // Resolve a wikilink target title to an artifact and navigate
  const handleWikilinkNavigate = useCallback(
    (target: string) => {
      const artifacts = useVaultStore.getState().artifacts
      const match = artifacts.find((a) => a.title.toLowerCase() === target.toLowerCase())
      if (match) onNavigate(match.id)
    },
    [onNavigate]
  )

  // Build Tiptap extensions
  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: null, target: null } }),
      ConceptNodeMark,
      CalloutBlock,
      HighlightMark,
      WikilinkNode.configure({ onNavigate: handleWikilinkNavigate }),
      DragHandle.configure({
        render() {
          const el = document.createElement('div')
          el.className = 'te-drag-handle'
          el.innerHTML = '⠿'
          return el
        }
      }),
      SlashCommand
    ],
    [handleWikilinkNavigate]
  )

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      const manager = ed.storage.markdown?.manager
      if (manager) {
        let markdown = manager.serialize(ed.getJSON())
        const rawFm = frontmatterRawRef.current
        if (rawFm) {
          markdown = rawFm + markdown
        }
        setContent(markdown)
        // Push directly to DocumentManager from user action (not via effect)
        const path = useEditorStore.getState().activeNotePath
        if (path && prevLoadedPathRef.current === path) {
          doc.update(markdown)
        }
      }
    },
    [setContent, doc]
  )

  const handleSelectionUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      const { from } = ed.state.selection
      const resolved = ed.state.doc.resolve(from)
      const lineBlock = resolved.node(1)
      const lineText = lineBlock ? lineBlock.textContent : ''
      const offset = from - resolved.start(1)
      const lineNumber = resolved.depth > 0 ? resolved.index(0) + 1 : 1
      const colNumber = Math.max(1, offset + 1)
      setCursorPosition(lineNumber, Math.min(colNumber, lineText.length + 1))
    },
    [setCursorPosition]
  )

  // Right-click handler: show context menu for concept node linking
  const handleContextMenu = useCallback((view: EditorView, event: MouseEvent) => {
    const { from, to, empty } = view.state.selection
    if (empty) return false

    // Guard: only allow single-paragraph (single-block) selections
    const $from = view.state.doc.resolve(from)
    const $to = view.state.doc.resolve(to)
    if ($from.depth < 1 || $from.node(1) !== $to.node(1)) return false

    event.preventDefault()

    const hasConceptMark = view.state.doc.rangeHasMark(
      from,
      to,
      view.state.schema.marks.conceptNode
    )

    const actions: ContextMenuAction[] = hasConceptMark
      ? [
          {
            label: 'Unlink concept',
            onClick: () => editorRef.current?.commands.unsetConceptNode()
          }
        ]
      : [
          {
            label: 'Link as concept',
            onClick: () => editorRef.current?.commands.setConceptNode()
          }
        ]

    setContextMenu({ x: event.clientX, y: event.clientY, actions })
    return true
  }, [])

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: handleUpdate,
    onSelectionUpdate: handleSelectionUpdate,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-full px-8 py-12',
        style: `color: ${colors.text.primary};`
      },
      handleDOMEvents: {
        contextmenu: (view, event) => handleContextMenu(view, event)
      }
    }
  })

  editorRef.current = editor // eslint-disable-line react-hooks/immutability -- ref tracks latest editor instance for context menu callbacks

  // Conflict resolution via DocumentManager
  const handleReloadFromDisk = useCallback(async () => {
    await doc.resolveConflict('disk')
    prevLoadedPathRef.current = null
  }, [doc])

  const handleKeepMine = useCallback(async () => {
    await doc.resolveConflict('mine')
  }, [doc])

  // Reset refs when path changes to prevent stale data leaking across files
  const prevPathRef = useRef(activeNotePath)
  if (prevPathRef.current !== activeNotePath) {
    prevPathRef.current = activeNotePath
    prevLoadedPathRef.current = null
    frontmatterRawRef.current = ''
  }

  // Load file content from DocumentManager and sync to Tiptap in one atomic step.
  // Collapsing these into one effect eliminates the race window where React can
  // interleave renders between content load and Tiptap sync.
  useEffect(() => {
    if (!activeNotePath || !editor || doc.content === null || doc.loading) return
    // Skip if already loaded for this path and user is editing
    if (activeNotePath === prevLoadedPathRef.current && useEditorStore.getState().isDirty) return

    prevLoadedPathRef.current = activeNotePath
    loadContent(doc.content)

    // Parse frontmatter and sync to Tiptap immediately (same synchronous block)
    const parsed = parseFrontmatter(doc.content)
    frontmatterRawRef.current = parsed.raw
    setFrontmatterData(parsed.data as Record<string, string | readonly string[]>)

    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(parsed.body)
      editor.commands.setContent(json)
    } else {
      editor.commands.setContent(parsed.body)
    }
  }, [activeNotePath, doc.content, doc.loading, loadContent, editor])

  // Note: content pushes to DocumentManager happen directly in handleUpdate
  // and onFrontmatterChange callbacks, NOT via a useEffect. This eliminates
  // the race condition where stale content from file A could be pushed to
  // DocumentManager under file B's path during rapid file switching.

  // Empty state - only show when no file is selected
  // Floating chrome inset: editor content shifts right to clear the floating sidebar
  const insetStyle = {
    backgroundColor: 'var(--color-bg-base)'
  } as React.CSSProperties

  if (!activeNotePath) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ color: colors.text.muted, ...insetStyle }}
      >
        <div className="text-center">
          <p className="text-lg mb-2">No file selected</p>
          <p className="text-sm">Select a file from the sidebar or press Cmd+N to create one</p>
        </div>
      </div>
    )
  }

  // Non-markdown files get a code editor with syntax highlighting
  if (!activeNotePath.endsWith('.md')) {
    return (
      <div className="h-full" style={insetStyle}>
        <CodeFileEditor filePath={activeNotePath} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={insetStyle}>
      {doc.isConflict && (
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{
            backgroundColor: 'rgba(234, 179, 8, 0.12)',
            borderBottom: '1px solid rgba(234, 179, 8, 0.3)',
            color: '#eab308'
          }}
        >
          <span className="text-xs font-medium">
            File changed on disk (modified by another process)
          </span>
          <span className="flex gap-2">
            <button
              className="text-xs px-2 py-0.5 rounded hover:opacity-80"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.2)',
                color: '#eab308',
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={handleReloadFromDisk}
            >
              Reload from disk
            </button>
            <button
              className="text-xs px-2 py-0.5 rounded hover:opacity-80"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                color: colors.text.secondary,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={handleKeepMine}
            >
              Keep my version
            </button>
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <FrontmatterHeader
          artifact={artifact}
          frontmatter={frontmatterData}
          mode={mode}
          onNavigate={onNavigate}
          onFrontmatterChange={(newRaw) => {
            frontmatterRawRef.current = newRaw
            const parsed = parseFrontmatter(newRaw)
            setFrontmatterData(parsed.data as Record<string, string | readonly string[]>)
            const currentParsed = parseFrontmatter(content ?? '')
            const fullContent = newRaw + currentParsed.body
            setContent(fullContent)
            // Push directly to DocumentManager from user action (not via effect)
            if (activeNotePath && prevLoadedPathRef.current === activeNotePath) {
              doc.update(fullContent)
            }
          }}
        />
        {mode === 'rich' ? (
          <>
            <RichEditor editor={editor} />
            {editor && <EditorBubbleMenu editor={editor} />}
          </>
        ) : (
          <SourceEditor content={content} onChange={setContent} />
        )}
      </div>

      <BacklinksPanel
        currentNoteId={activeNoteId ?? ''}
        currentNotePath={activeNotePath ?? ''}
        currentNoteTitle={artifact?.title}
        backlinks={backlinks}
        onNavigate={onNavigate}
      />

      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenu.actions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
