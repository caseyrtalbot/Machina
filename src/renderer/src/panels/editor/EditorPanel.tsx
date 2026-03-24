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
import DragHandle from '@tiptap/extension-drag-handle'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { EditorContextMenu, type ContextMenuAction } from './EditorContextMenu'
import { colors } from '../../design/tokens'
import { isSystemArtifactPath } from '@shared/system-artifacts'

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
  const conflictPath = useEditorStore((s) => s.conflictPath)
  const hasConflict = conflictPath === activeNotePath && activeNotePath !== null

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
    []
  )

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      const manager = ed.storage.markdown?.manager
      if (manager) {
        let markdown = manager.serialize(ed.getJSON())
        // Re-prepend original frontmatter for lossless round-tripping
        const rawFm = frontmatterRawRef.current
        if (rawFm) {
          markdown = rawFm + markdown
        }
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

  editorRef.current = editor

  // Conflict resolution: reload from disk or keep local version
  const handleReloadFromDisk = useCallback(async () => {
    if (!activeNotePath) return
    const [fileContent, mtime] = await Promise.all([
      window.api.fs.readFile(activeNotePath),
      window.api.fs.fileMtime(activeNotePath)
    ])
    loadContent(fileContent)
    if (mtime) {
      useEditorStore.getState().setFileMtime(activeNotePath, mtime)
    }
    useEditorStore.getState().setConflictPath(null)
    // Reset the loaded-path ref so the content sync effect re-runs
    prevLoadedPathRef.current = null
  }, [activeNotePath, loadContent])

  const handleKeepMine = useCallback(async () => {
    if (!activeNotePath) return
    const state = useEditorStore.getState()
    // Force write, ignoring the mtime mismatch
    await window.api.fs.writeFile(activeNotePath, state.content)
    const newMtime = await window.api.fs.fileMtime(activeNotePath)
    if (newMtime) {
      useEditorStore.getState().setFileMtime(activeNotePath, newMtime)
    }
    useEditorStore.getState().setConflictPath(null)
    useEditorStore.getState().markSaved()
  }, [activeNotePath])

  // Live reload: subscribe to file-change events for the active file.
  // If the editor is clean (no unsaved edits), silently reload from disk.
  // If the editor is dirty, compare content before showing the conflict banner.
  useEffect(() => {
    if (!activeNotePath) return

    const unsub = window.api.on.fileChanged(async (data) => {
      if (data.path !== activeNotePath || data.event !== 'change') return

      const state = useEditorStore.getState()

      if (!state.isDirty) {
        // Editor is clean: silently reload from disk (Obsidian model)
        const [fileContent, mtime] = await Promise.all([
          window.api.fs.readFile(activeNotePath),
          window.api.fs.fileMtime(activeNotePath)
        ])
        if (useEditorStore.getState().activeNotePath !== activeNotePath) return
        loadContent(fileContent)
        if (mtime) useEditorStore.getState().setFileMtime(activeNotePath, mtime)
        prevLoadedPathRef.current = null
      } else {
        // Editor is dirty: check if disk content matches editor content
        const diskContent = await window.api.fs.readFile(activeNotePath)
        const mtime = await window.api.fs.fileMtime(activeNotePath)
        if (useEditorStore.getState().activeNotePath !== activeNotePath) return

        if (diskContent === useEditorStore.getState().content) {
          // Content matches: split editor wrote what we already have. Update mtime.
          if (mtime) useEditorStore.getState().setFileMtime(activeNotePath, mtime)
        } else {
          // Genuine conflict: disk differs from unsaved editor content
          useEditorStore.getState().setConflictPath(activeNotePath)
        }
      }
    })

    return unsub
  }, [activeNotePath, loadContent])

  // Load file content from disk when active note path changes
  useEffect(() => {
    if (!activeNotePath || activeNotePath === prevLoadedPathRef.current) return
    prevLoadedPathRef.current = activeNotePath

    // Clear any conflict state for the previous file
    useEditorStore.getState().setConflictPath(null)

    Promise.all([window.api.fs.readFile(activeNotePath), window.api.fs.fileMtime(activeNotePath)])
      .then(([fileContent, mtime]) => {
        if (useEditorStore.getState().activeNotePath !== activeNotePath) return
        loadContent(fileContent)
        if (mtime) {
          useEditorStore.getState().setFileMtime(activeNotePath, mtime)
        }
      })
      .catch(() => {
        if (useEditorStore.getState().activeNotePath === activeNotePath) {
          loadContent('')
        }
      })
  }, [activeNotePath, loadContent])

  // Sync loaded content into Tiptap editor when content changes for a new file
  useEffect(() => {
    if (!editor || !content || !activeNotePath) return
    // Only sync on fresh file loads, not user edits
    if (useEditorStore.getState().isDirty) return

    const parsed = parseFrontmatter(content)
    frontmatterRawRef.current = parsed.raw
    setFrontmatterData(parsed.data as Record<string, string | readonly string[]>)

    // Wikilinks are now auto-detected as graph edges via bodyLinks.
    // No migration to <node> tags needed — both syntaxes coexist.
    const body = parsed.body

    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(body)
      editor.commands.setContent(json)
    } else {
      editor.commands.setContent(body)
    }
  }, [content, editor, activeNotePath, setContent])

  // Autosave: debounce writes by 1 second, with mtime conflict check
  useEffect(() => {
    if (!activeNotePath) return
    const pathToSave = activeNotePath
    const contentToSave = content

    const state = useEditorStore.getState()
    if (!state.isDirty) return
    // Skip autosave while a conflict is active for this file
    if (state.conflictPath === pathToSave) return

    const timer = setTimeout(async () => {
      // Check if file was modified externally since we loaded it
      const expectedMtime = useEditorStore.getState().fileMtimes[pathToSave]
      if (expectedMtime) {
        const currentMtime = await window.api.fs.fileMtime(pathToSave)
        if (currentMtime && currentMtime !== expectedMtime) {
          useEditorStore.getState().setConflictPath(pathToSave)
          return
        }
      }

      await window.api.fs.writeFile(pathToSave, contentToSave)

      // Update stored mtime after successful write
      const newMtime = await window.api.fs.fileMtime(pathToSave)
      if (newMtime) {
        useEditorStore.getState().setFileMtime(pathToSave, newMtime)
      }

      if (isSystemArtifactPath(pathToSave)) {
        const { syncSystemArtifactFromDisk } =
          await import('../../system-artifacts/system-artifact-runtime')
        await syncSystemArtifactFromDisk(pathToSave)
      }
      const current = useEditorStore.getState()
      if (current.activeNotePath === pathToSave) {
        current.markSaved()
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [content, activeNotePath])

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
      {hasConflict && (
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
            // Parse the updated frontmatter for display
            const parsed = parseFrontmatter(newRaw)
            setFrontmatterData(parsed.data as Record<string, string | readonly string[]>)
            // Reconstruct full content: new frontmatter + existing body
            const currentParsed = parseFrontmatter(content ?? '')
            setContent(newRaw + currentParsed.body)
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
