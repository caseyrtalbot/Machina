import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorToolbar } from './EditorToolbar'
import { EditorBreadcrumb } from './EditorBreadcrumb'
import { TabBar } from './TabBar'
import { FrontmatterHeader } from './FrontmatterHeader'
import { BacklinksPanel } from './BacklinksPanel'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { parseFrontmatter, preprocessWikilinks, postprocessWikilinks } from './markdown-utils'
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
  const loadContent = useEditorStore((s) => s.loadContent)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  // Tabs
  const openTabs = useEditorStore((s) => s.openTabs)
  const switchTab = useEditorStore((s) => s.switchTab)
  const closeTab = useEditorStore((s) => s.closeTab)

  // Navigation (from store)
  const historyIndex = useEditorStore((s) => s.historyIndex)
  const historyStack = useEditorStore((s) => s.historyStack)
  const goBack = useEditorStore((s) => s.goBack)
  const goForward = useEditorStore((s) => s.goForward)

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < historyStack.length - 1

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const files = useVaultStore((s) => s.files)
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
  // Ref for wikilink navigation so the Tiptap click handler always uses the latest function
  const resolveAndNavigateRef = useRef((_target: string) => {})
  const [frontmatterData, setFrontmatterData] = useState<
    Readonly<Record<string, string | readonly string[]>>
  >({})

  // Build Tiptap extensions
  const extensions = useMemo(
    () => [
      StarterKit,
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: null, target: null } })
    ],
    []
  )

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed) return
      const manager = ed.storage.markdown?.manager
      if (manager) {
        let markdown = manager.serialize(ed.getJSON())
        markdown = postprocessWikilinks(markdown)
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

  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: handleUpdate,
    onSelectionUpdate: handleSelectionUpdate,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-full px-8 py-6',
        style: `color: ${colors.text.primary};`
      },
      // Intercept clicks on wikilinks to navigate instead of following href
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement
        const anchor = target.closest('a')
        if (!anchor) return false

        const href = anchor.getAttribute('href')
        if (!href?.startsWith('wikilink:')) return false

        event.preventDefault()
        const linkTarget = decodeURIComponent(href.slice('wikilink:'.length))
        resolveAndNavigateRef.current(linkTarget)
        return true
      }
    }
  })

  // Keep the ref current so Tiptap's click handler always resolves against latest files
  resolveAndNavigateRef.current = useCallback(
    (target: string) => {
      const normalized = target.toLowerCase()
      const match = files.find((f) => {
        const name = f.filename.replace(/\.md$/, '').toLowerCase()
        return name === normalized
      })

      if (match) {
        useEditorStore.getState().openTab(match.path, match.filename.replace(/\.md$/, ''))
      }
    },
    [files]
  )

  // Load file content from disk when active note path changes
  useEffect(() => {
    if (!activeNotePath || activeNotePath === prevLoadedPathRef.current) return
    prevLoadedPathRef.current = activeNotePath

    window.api.fs
      .readFile(activeNotePath)
      .then((fileContent) => {
        // Guard against stale async: only apply if still the active path
        if (useEditorStore.getState().activeNotePath === activeNotePath) {
          loadContent(fileContent)
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

    const processedBody = preprocessWikilinks(parsed.body)

    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(processedBody)
      editor.commands.setContent(json)
    } else {
      editor.commands.setContent(processedBody)
    }
  }, [content, editor, activeNotePath])

  // Autosave: debounce writes by 1 second
  useEffect(() => {
    if (!activeNotePath) return
    // Capture path and content NOW, not when the timer fires
    const pathToSave = activeNotePath
    const contentToSave = content

    if (!useEditorStore.getState().isDirty) return

    const timer = setTimeout(async () => {
      await window.api.fs.writeFile(pathToSave, contentToSave)
      // Only mark saved if still on the same file
      const current = useEditorStore.getState()
      if (current.activeNotePath === pathToSave) {
        current.markSaved()
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [content, activeNotePath])

  const handleToggleMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

  // Empty state - only show when no file is selected
  if (!activeNotePath) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: colors.text.muted }}>
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
    <div className="h-full flex flex-col">
      <TabBar tabs={openTabs} activePath={activeNotePath} onSwitch={switchTab} onClose={closeTab} />

      <EditorBreadcrumb
        filePath={filePath}
        vaultPath={resolvedVaultPath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={goBack}
        onGoForward={goForward}
      />

      <EditorToolbar editor={editor} mode={mode} onToggleMode={handleToggleMode} />

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

      <div className="flex-1 overflow-y-auto">
        {mode === 'rich' ? (
          <RichEditor editor={editor} />
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
    </div>
  )
}
