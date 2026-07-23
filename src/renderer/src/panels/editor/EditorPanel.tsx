import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { FrontmatterHeader } from './FrontmatterHeader'
import { BacklinksPanel } from './BacklinksPanel'
import { RichEditor } from './RichEditor'
import { SourceEditor } from './SourceEditor'
import { CodeFileEditor } from './CodeFileEditor'
import { parseFrontmatter, type PropertyValue } from './markdown-utils'
import { ConceptNodeMark } from './extensions/concept-node-mark'
import { MermaidCodeBlock } from './extensions/mermaid-code-block'
import { SlashCommand } from './extensions/slash-command'
import { CalloutBlock } from './extensions/callout-block'
import { HighlightMark } from './extensions/highlight-mark'
import { FindInNote } from './extensions/find-in-note'
import { FindBar } from './FindBar'
import { WikilinkNode } from './extensions/wikilink-node'
import { VaultImage, resolveVaultImageUrl } from './extensions/vault-image'
import DragHandle from '@tiptap/extension-drag-handle'
import { MachinaTableKit } from './extensions/table-kit'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu'
import { borderRadius, colors, typography } from '../../design/tokens'
import { useDocument } from '../../hooks/useDocument'
import { resolveWikilinkTarget, parseWikilinkTarget } from '@shared/engine/wikilink-resolver'
import { OutlinePanel } from './OutlinePanel'
import { useUiStore } from '../../store/ui-store'

interface EditorPanelProps {
  onNavigate: (id: string) => void
}

export function EditorPanel({ onNavigate }: EditorPanelProps) {
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const content = useEditorStore((s) => s.content)
  const setContent = useEditorStore((s) => s.setContent)
  const syncContent = useEditorStore((s) => s.syncContent)
  const loadContent = useEditorStore((s) => s.loadContent)
  const setDirty = useEditorStore((s) => s.setDirty)

  const outlineVisible = useUiStore((s) => s.outlineVisible)
  const toggleOutline = useUiStore((s) => s.toggleOutline)

  const historyIndex = useEditorStore((s) => s.historyIndex)
  const historyLength = useEditorStore((s) => s.historyStack.length)
  const goBack = useEditorStore((s) => s.goBack)
  const goForward = useEditorStore((s) => s.goForward)
  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < historyLength - 1

  const fileToId = useVaultStore((s) => s.fileToId)
  const activeNoteId = activeNotePath ? (fileToId[activeNotePath] ?? null) : null

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
  const [frontmatterData, setFrontmatterData] = useState<Readonly<Record<string, PropertyValue>>>(
    {}
  )

  // Context menu state for concept node linking
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)

  // Find-in-note bar (rich mode). Counter instead of boolean so a repeat
  // Cmd+F while open refocuses the input; 0 = closed.
  const [findSignal, setFindSignal] = useState(0)
  const handleFindOpen = useCallback(() => setFindSignal((s) => s + 1), [])
  const closeFindBar = useCallback(() => setFindSignal(0), [])

  // Resolve a wikilink target to an artifact and navigate, with optional heading scroll
  const handleWikilinkNavigate = useCallback(
    (target: string) => {
      const { artifacts, artifactPathById } = useVaultStore.getState()
      const { heading } = parseWikilinkTarget(target)
      const resolved = resolveWikilinkTarget(target, artifacts, artifactPathById)
      if (resolved) {
        useEditorStore.getState().setPendingScrollTarget(heading)
        onNavigate(resolved)
      }
    },
    [onNavigate]
  )

  // Resolve a vault-relative image src to a blob URL: try relative to the
  // open note's folder first (standard markdown), then the vault root.
  const resolveImageSrc = useCallback(async (src: string): Promise<string | null> => {
    let decoded = src
    if (src.includes('%')) {
      try {
        decoded = decodeURIComponent(src)
      } catch {
        decoded = src
      }
    }
    const candidates: string[] = []
    if (decoded.startsWith('/')) {
      candidates.push(decoded)
    } else {
      const notePath = useEditorStore.getState().activeNotePath
      const noteDir = notePath ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
      if (noteDir) candidates.push(`${noteDir}/${decoded}`)
      const vaultPath = useVaultStore.getState().vaultPath
      if (vaultPath) candidates.push(`${vaultPath.replace(/\/$/, '')}/${decoded}`)
    }
    return resolveVaultImageUrl(candidates)
  }, [])

  // Build Tiptap extensions
  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      ConceptNodeMark,
      CalloutBlock,
      HighlightMark,
      WikilinkNode.configure({ onNavigate: handleWikilinkNavigate }),
      VaultImage.configure({ resolveSrc: resolveImageSrc }),
      FindInNote.configure({ onOpen: handleFindOpen }),
      MachinaTableKit,
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
    [handleWikilinkNavigate, handleFindOpen, resolveImageSrc]
  )

  // Stable ref for the resolved path so callbacks don't go stale
  const resolvedPathRef = useRef(activeNotePath)
  resolvedPathRef.current = activeNotePath

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
        const path = resolvedPathRef.current
        if (path && prevLoadedPathRef.current === path) {
          doc.update(markdown)
        }
      }
    },
    [setContent, doc]
  )

  // Source mode routes through DocumentManager too, so both modes share
  // the same autosave/conflict pipeline.
  const handleSourceChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      const path = resolvedPathRef.current
      if (path && prevLoadedPathRef.current === path) {
        doc.update(newContent)
      }
    },
    [setContent, doc]
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

    const items: ContextMenuItem[] = hasConceptMark
      ? [
          {
            id: 'unlink-concept',
            label: 'Unlink concept',
            onSelect: () => editorRef.current?.commands.unsetConceptNode()
          }
        ]
      : [
          {
            id: 'link-concept',
            label: 'Link as concept',
            onSelect: () => editorRef.current?.commands.setConceptNode()
          }
        ]

    setContextMenu({ x: event.clientX, y: event.clientY, items })
    return true
  }, [])

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: handleUpdate,
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

  // DocumentManager is the single source of truth for dirty state: the store
  // flag mirrors it so tab indicators and switch-away flushes stay accurate,
  // and autosaves (doc:saved) clear it instead of leaving it stuck on.
  useEffect(() => {
    setDirty(doc.isDirty)
  }, [doc.isDirty, setDirty])

  // Latest dirty state readable inside the sync effect without retriggering
  // it (re-parsing into Tiptap on every autosave would reset the cursor).
  const docDirtyRef = useRef(doc.isDirty)
  docDirtyRef.current = doc.isDirty

  // Load file content from DocumentManager and sync to Tiptap in one atomic step.
  // Collapsing these into one effect eliminates the race window where React can
  // interleave renders between content load and Tiptap sync.
  // Runs again when doc.content changes while clean — i.e. an external/agent
  // edit arrived — so the open note re-parses instead of going stale.
  useEffect(() => {
    if (!activeNotePath || !editor || doc.content === null || doc.loading) return
    // Skip if already loaded for this path and user has unsaved edits
    if (activeNotePath === prevLoadedPathRef.current && docDirtyRef.current) return

    prevLoadedPathRef.current = activeNotePath
    loadContent(doc.content)

    // Parse frontmatter and sync to Tiptap immediately (same synchronous block)
    const parsed = parseFrontmatter(doc.content)
    frontmatterRawRef.current = parsed.raw
    setFrontmatterData(parsed.data)

    // Loading a file into Tiptap is not a user edit. Tiptap 3 flipped
    // setContent's `emitUpdate` default to true, so without this flag the load
    // fires onUpdate → handleUpdate → doc.update, rewriting the file through the
    // lossy markdown round-trip on open (corrupts code/binary, silently
    // re-serializes untouched notes). emitUpdate:false makes open a pure load.
    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(parsed.body)
      editor.commands.setContent(json, { emitUpdate: false })
    } else {
      editor.commands.setContent(parsed.body, { emitUpdate: false })
    }

    // Scroll to heading if navigated via [[Note#heading]]
    const scrollTarget = useEditorStore.getState().pendingScrollTarget
    if (scrollTarget) {
      useEditorStore.getState().setPendingScrollTarget(null)
      const lowerTarget = scrollTarget.toLowerCase().replace(/-/g, ' ')
      let targetPos: number | null = null
      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false
        if (node.type.name === 'heading') {
          const headingText = node.textContent.toLowerCase().replace(/-/g, ' ')
          if (headingText === lowerTarget) {
            targetPos = pos
            return false
          }
        }
        return true
      })
      if (targetPos !== null) {
        editor.commands.setTextSelection(targetPos)
        // Defer scroll to next frame so the editor layout is settled
        requestAnimationFrame(() => {
          editor.commands.scrollIntoView()
        })
      }
    }
  }, [activeNotePath, doc.content, doc.loading, loadContent, editor])

  // Mode switching round-trips through the markdown text so edits survive:
  // rich→source seeds the source view from the freshly serialized Tiptap doc;
  // source→rich re-parses the (possibly edited) source text into Tiptap.
  const handleModeChange = useCallback(
    (next: 'rich' | 'source') => {
      if (next === mode) {
        return
      }
      const ed = editorRef.current
      const manager = ed?.storage.markdown?.manager
      if (next === 'source') {
        // Source mode has its own CodeMirror search; unmounting the FindBar
        // clears rich-mode highlight decorations via its cleanup effect.
        setFindSignal(0)
        if (ed && manager) {
          // syncContent (not setContent): re-serializing for display is not a
          // user edit — marking the store dirty here would rewrite an
          // untouched file on the next switch-away flush.
          syncContent(frontmatterRawRef.current + manager.serialize(ed.getJSON()))
        }
      } else {
        const parsed = parseFrontmatter(useEditorStore.getState().content)
        frontmatterRawRef.current = parsed.raw
        setFrontmatterData(parsed.data)
        if (ed) {
          // Re-parsing already-saved source text into Tiptap is a display
          // sync, not a fresh edit — don't emit onUpdate (see load effect).
          ed.commands.setContent(manager ? manager.parse(parsed.body) : parsed.body, {
            emitUpdate: false
          })
        }
        prevLoadedPathRef.current = resolvedPathRef.current
      }
      setMode(next)
    },
    [mode, setMode, syncContent]
  )

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
            // Console callout: 2px accent left-bar + accent-soft tint
            borderLeft: `2px solid ${colors.claude.warning}`,
            backgroundColor: `color-mix(in srgb, ${colors.claude.warning} 10%, transparent)`,
            borderBottom: `1px solid ${colors.border.subtle}`,
            color: colors.claude.warning,
            fontFamily: typography.fontFamily.mono
          }}
        >
          <span
            style={{
              fontSize: typography.metadata.size,
              textTransform: 'uppercase',
              letterSpacing: typography.metadata.letterSpacing,
              fontWeight: 600
            }}
          >
            File changed on disk
          </span>
          <span className="flex gap-2">
            <button
              className="hover:opacity-80"
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: borderRadius.inline,
                backgroundColor: 'transparent',
                color: colors.claude.warning,
                border: `1px solid ${colors.claude.warning}`,
                cursor: 'pointer',
                fontFamily: typography.fontFamily.mono,
                textTransform: 'uppercase',
                letterSpacing: typography.metadata.letterSpacing
              }}
              onClick={handleReloadFromDisk}
            >
              Reload from disk
            </button>
            <button
              className="hover:opacity-80"
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: borderRadius.inline,
                backgroundColor: 'transparent',
                color: colors.text.secondary,
                border: `1px solid ${colors.border.default}`,
                cursor: 'pointer',
                fontFamily: typography.fontFamily.mono,
                textTransform: 'uppercase',
                letterSpacing: typography.metadata.letterSpacing
              }}
              onClick={handleKeepMine}
            >
              Keep my version
            </button>
          </span>
        </div>
      )}
      <div className="editor-mode-bar">
        {/* Back/forward chrome: the history stack already exists in
            editor-store; this is the visible way out of a wikilink rabbit-hole. */}
        <div className="flex items-center" style={{ marginRight: 'auto' }}>
          <button
            type="button"
            className="editor-mode-toggle__btn"
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Back"
            title="Back (⌘⌥←)"
            style={!canGoBack ? { opacity: 0.35, cursor: 'default' } : undefined}
          >
            ←
          </button>
          <button
            type="button"
            className="editor-mode-toggle__btn"
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Forward"
            title="Forward (⌘⌥→)"
            style={!canGoForward ? { opacity: 0.35, cursor: 'default' } : undefined}
          >
            →
          </button>
        </div>
        {/* Mode switch, not a tab bar: aria-pressed buttons (role="tab" lives
            only in the TabBar primitive). */}
        <div role="group" aria-label="Editor mode" className="flex items-center">
          <button
            type="button"
            aria-pressed={mode === 'rich'}
            className={`editor-mode-toggle__btn${mode === 'rich' ? ' editor-mode-toggle__btn--active' : ''}`}
            onClick={() => handleModeChange('rich')}
          >
            Rich
          </button>
          <button
            type="button"
            aria-pressed={mode === 'source'}
            className={`editor-mode-toggle__btn${mode === 'source' ? ' editor-mode-toggle__btn--active' : ''}`}
            onClick={() => handleModeChange('source')}
          >
            Source
          </button>
        </div>
        <button
          type="button"
          className={`editor-mode-toggle__btn${outlineVisible ? ' editor-mode-toggle__btn--active' : ''}`}
          aria-pressed={outlineVisible}
          onClick={toggleOutline}
          title="Toggle outline (⌘⇧O)"
          style={{ marginLeft: 8 }}
        >
          Outline
        </button>
      </div>
      <div className="flex-1 flex min-h-0 min-w-0 relative">
        {mode === 'rich' && editor && findSignal > 0 && (
          <FindBar editor={editor} focusSignal={findSignal} onClose={closeFindBar} />
        )}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <FrontmatterHeader
            artifact={artifact}
            frontmatter={frontmatterData}
            mode={mode}
            onNavigate={onNavigate}
            onFrontmatterChange={(newRaw) => {
              frontmatterRawRef.current = newRaw
              const parsed = parseFrontmatter(newRaw)
              setFrontmatterData(parsed.data)
              const fullContent = newRaw + parseFrontmatter(content).body
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
            <SourceEditor content={content} onChange={handleSourceChange} />
          )}
        </div>
        {outlineVisible && editor && mode === 'rich' && (
          <div
            className="shrink-0 overflow-hidden"
            style={{
              width: 200,
              borderLeft: `1px solid ${colors.border.subtle}`
            }}
          >
            <OutlinePanel editor={editor} />
          </div>
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
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
