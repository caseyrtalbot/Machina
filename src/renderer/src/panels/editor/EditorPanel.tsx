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
import { WikilinkNode } from './extensions/wikilink-node'
import DragHandle from '@tiptap/extension-drag-handle'
import { MachinaTableKit } from './extensions/table-kit'
import { EditorBubbleMenu } from './EditorBubbleMenu'
import { EditorContextMenu, type ContextMenuAction } from './EditorContextMenu'
import { borderRadius, colors, typography } from '../../design/tokens'
import { useDocument } from '../../hooks/useDocument'
import { resolveWikilinkTarget, parseWikilinkTarget } from '@shared/engine/wikilink-resolver'
import { OutlinePanel } from './OutlinePanel'
import { useUiStore } from '../../store/ui-store'

interface EditorPanelProps {
  onNavigate: (id: string) => void
  /** When provided, renders this file instead of the store's activeNotePath. */
  filePath?: string | null
}

export function EditorPanel({ onNavigate, filePath }: EditorPanelProps) {
  const storeNotePath = useEditorStore((s) => s.activeNotePath)
  const activeNotePath = filePath !== undefined ? filePath : storeNotePath
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const content = useEditorStore((s) => s.content)
  const setContent = useEditorStore((s) => s.setContent)
  const loadContent = useEditorStore((s) => s.loadContent)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  const outlineVisible = useUiStore((s) => s.outlineVisible)

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
    actions: ContextMenuAction[]
  } | null>(null)

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
    [handleWikilinkNavigate]
  )

  // Stable ref for the resolved path so callbacks don't go stale
  const resolvedPathRef = useRef(activeNotePath)
  resolvedPathRef.current = activeNotePath

  const isSplitPane = filePath !== undefined

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
        if (!isSplitPane) setContent(markdown)
        // Push directly to DocumentManager from user action (not via effect)
        const path = resolvedPathRef.current
        if (path && prevLoadedPathRef.current === path) {
          doc.update(markdown)
        }
      }
    },
    [setContent, doc, isSplitPane]
  )

  const handleSelectionUpdate = useCallback(
    ({ editor: ed }: { editor: ReturnType<typeof useEditor> }) => {
      if (!ed || isSplitPane) return
      const { from } = ed.state.selection
      const resolved = ed.state.doc.resolve(from)
      const lineBlock = resolved.node(1)
      const lineText = lineBlock ? lineBlock.textContent : ''
      const offset = from - resolved.start(1)
      const lineNumber = resolved.depth > 0 ? resolved.index(0) + 1 : 1
      const colNumber = Math.max(1, offset + 1)
      setCursorPosition(lineNumber, Math.min(colNumber, lineText.length + 1))
    },
    [setCursorPosition, isSplitPane]
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
    if (
      activeNotePath === prevLoadedPathRef.current &&
      (isSplitPane || useEditorStore.getState().isDirty)
    )
      return

    prevLoadedPathRef.current = activeNotePath
    if (!isSplitPane) loadContent(doc.content)

    // Parse frontmatter and sync to Tiptap immediately (same synchronous block)
    const parsed = parseFrontmatter(doc.content)
    frontmatterRawRef.current = parsed.raw
    setFrontmatterData(parsed.data)

    const manager = editor.storage.markdown?.manager
    if (manager) {
      const json = manager.parse(parsed.body)
      editor.commands.setContent(json)
    } else {
      editor.commands.setContent(parsed.body)
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
  }, [activeNotePath, doc.content, doc.loading, loadContent, editor, isSplitPane])

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
            backgroundColor: 'color-mix(in srgb, #dfa11a 10%, transparent)',
            borderBottom: `1px solid ${colors.border.subtle}`,
            color: colors.claude.warning,
            fontFamily: typography.fontFamily.mono
          }}
        >
          <span
            style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
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
      <div className="editor-mode-bar" role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'rich'}
          className={`editor-mode-toggle__btn${mode === 'rich' ? ' editor-mode-toggle__btn--active' : ''}`}
          onClick={() => setMode('rich')}
        >
          Rich
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'source'}
          className={`editor-mode-toggle__btn${mode === 'source' ? ' editor-mode-toggle__btn--active' : ''}`}
          onClick={() => setMode('source')}
        >
          Source
        </button>
      </div>
      <div className="flex-1 flex min-h-0 min-w-0">
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
              const currentParsed = parseFrontmatter(content ?? '')
              const fullContent = newRaw + currentParsed.body
              if (!isSplitPane) setContent(fullContent)
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
