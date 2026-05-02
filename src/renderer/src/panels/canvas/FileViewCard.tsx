import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import matter from 'gray-matter'
import { useCanvasStore } from '../../store/canvas-store'
import { useEditorStore } from '../../store/editor-store'
import { useThreadStore } from '../../store/thread-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import { computeLineDelta, countLines } from './shared/file-view-utils'
import { createEditorExtensions, detectLanguage } from './shared/codemirror-setup'
import { extractSection } from '@shared/engine/section-rewriter'
import { rematchSections } from '@shared/engine/section-rematch'
import { commitSectionEdit } from './section-projection'
import type { CanvasNode } from '@shared/canvas-types'
import { vaultEvents } from '@engine/vault-event-hub'

const SECTION_EDIT_DEBOUNCE_MS = 1000

interface SectionProjection {
  readonly body: string
  /** Refreshed map — non-null only when external rename was unambiguous
   *  and the file's frontmatter should be re-saved. */
  readonly refreshedMap: Readonly<Record<string, string>> | null
  readonly unresolved: boolean
}

/**
 * If `sectionId` is set, returns only the body of the named section from
 * the raw file content. Handles external heading renames via rematch.
 */
function projectSection(raw: string, sectionId: string | null): SectionProjection {
  if (!sectionId) return { body: raw, refreshedMap: null, unresolved: false }
  const parsed = matter(raw)
  const sectionMap = (parsed.data.sections as Record<string, string> | undefined) ?? {}
  const direct = extractSection(parsed.content, sectionId, sectionMap)
  if (direct.ok) return { body: direct.value, refreshedMap: null, unresolved: false }

  const rematch = rematchSections(parsed.content, sectionMap)
  if (rematch.unresolved.includes(sectionId)) {
    return { body: '[section not found]', refreshedMap: null, unresolved: true }
  }
  const retry = extractSection(parsed.content, sectionId, rematch.resolved)
  if (!retry.ok) return { body: '[section not found]', refreshedMap: null, unresolved: true }
  return {
    body: retry.value,
    refreshedMap: rematch.changed ? rematch.resolved : null,
    unresolved: false
  }
}

interface FileViewCardProps {
  readonly node: CanvasNode
}

export function FileViewCard({ node }: FileViewCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const previousLineCountRef = useRef(0)

  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(node.content))
  const [error, setError] = useState<string | null>(null)
  const [modified, setModified] = useState(false)
  const [lineDelta, setLineDelta] = useState('')

  const removeNode = useCanvasStore((s) => s.removeNode)

  const filePath = node.content
  const sectionId = typeof node.metadata.section === 'string' ? node.metadata.section : null

  const filename = useMemo(() => {
    const parts = filePath.split('/')
    return parts[parts.length - 1] ?? 'file'
  }, [filePath])

  const language = useMemo(() => detectLanguage(filePath), [filePath])

  // Step 1: Read file content (separate from CodeMirror mounting)
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading gate before async fetch

    window.api.fs
      .readFile(filePath)
      .then(async (content: string) => {
        if (cancelled) return
        const { body, refreshedMap, unresolved } = projectSection(content, sectionId)
        setFileContent(body)
        previousLineCountRef.current = countLines(body)
        setLoading(false)
        setError(unresolved ? 'Section missing in file. Detach or re-pick a heading.' : null)
        if (refreshedMap) {
          const parsed = matter(content)
          const next = matter.stringify(parsed.content, {
            ...parsed.data,
            sections: refreshedMap
          })
          try {
            await window.api.document.update(filePath, next)
          } catch {
            // Non-fatal: the in-memory map is still correct; next save will sync.
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load file')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [filePath, sectionId])

  // Debounced commit for section edits. The ref holds a live handle so we
  // can clear on unmount and avoid firing after the card is gone.
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSectionEdit = useCallback(
    (newBody: string) => {
      if (!sectionId) return
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      commitTimerRef.current = setTimeout(async () => {
        commitTimerRef.current = null
        const r = await commitSectionEdit(filePath, sectionId, newBody, {
          readFile: (p) => window.api.fs.readFile(p),
          writeDocument: async (p, c) => {
            await window.api.document.update(p, c)
          }
        })
        if (!r.ok) {
          setError(`section write failed: ${r.error}`)
        }
      }, SECTION_EDIT_DEBOUNCE_MS)
    },
    [filePath, sectionId]
  )

  // Step 2: Mount CodeMirror once content is loaded and container exists
  useEffect(() => {
    if (!containerRef.current || fileContent === null) return

    let cancelled = false

    async function mount() {
      const readOnly = sectionId === null
      const extensions = await createEditorExtensions(language, {
        readOnly,
        onUpdate: sectionId ? handleSectionEdit : undefined
      })
      if (cancelled || !containerRef.current) return

      const state = EditorState.create({ doc: fileContent ?? '', extensions })
      const view = new EditorView({ state, parent: containerRef.current })
      viewRef.current = view
    }

    mount()

    return () => {
      cancelled = true
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [fileContent, language, sectionId, handleSectionEdit])

  // Subscribe to filesystem changes (freeze-then-signal pattern)
  useEffect(() => {
    if (!filePath) return

    const unsub = vaultEvents.subscribePath(filePath, (data) => {
      if (data.event === 'unlink') {
        setError('File not found or moved')
        return
      }

      if (data.event === 'change') {
        // Read new content only to compute delta, do NOT update display
        window.api.fs
          .readFile(filePath)
          .then((newContent: string) => {
            const delta = computeLineDelta(previousLineCountRef.current, newContent)
            setLineDelta(delta.display)
            setModified(true)
          })
          .catch(() => {
            // If read fails during change event, still mark modified
            setLineDelta('modified')
            setModified(true)
          })
      }
    })

    return () => {
      unsub()
    }
  }, [filePath])

  // Refresh: re-read file, update CodeMirror, clear modified state
  const handleRefresh = useCallback(() => {
    if (!filePath) return

    window.api.fs
      .readFile(filePath)
      .then((content: string) => {
        const { body, unresolved } = projectSection(content, sectionId)
        const view = viewRef.current
        if (view) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: body
            }
          })
        }
        previousLineCountRef.current = countLines(body)
        setModified(false)
        setLineDelta('')
        setError(unresolved ? 'Section missing in file. Detach or re-pick a heading.' : null)
      })
      .catch(() => {
        setError('Failed to load file')
      })
  }, [filePath, sectionId])

  // Keyboard: press R while card is focused to refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const focusedId = useCanvasStore.getState().focusedCardId
      if (focusedId !== node.id) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRefresh()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [node.id, handleRefresh])

  // Double-click: open in editor
  const handleDoubleClick = useCallback(() => {
    useEditorStore.getState().openTab(filePath, filename)
    useThreadStore.getState().addDockTab({ kind: 'editor', path: filePath })
  }, [filePath, filename])

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
      title={filename}
      filePath={filePath}
      onClose={() => removeNode(node.id)}
      onOpenInEditor={openInEditor}
      onContextMenu={handleContextMenu}
    >
      <div
        className="flex flex-col h-full"
        style={{ minHeight: 0 }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Code content area */}
        <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          {loading && (
            <div style={{ padding: 28 }}>
              <span className="text-sm" style={{ color: colors.text.muted }}>
                Loading...
              </span>
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 28 }}>
              <span className="text-sm" style={{ color: '#ef4444' }}>
                {error}
              </span>
            </div>
          )}
          {/* Always render container so ref is available for CodeMirror mounting */}
          <div
            ref={containerRef}
            className="h-full"
            style={{ display: loading || error ? 'none' : 'block' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Modified badge: compact notification bar at bottom */}
        {modified && (
          <div
            className="flex items-center justify-between shrink-0 px-3 py-1.5"
            style={{
              borderTop: `1px solid ${colors.border.subtle}`,
              backgroundColor: colors.accent.muted
            }}
          >
            <span className="text-xs font-mono" style={{ color: colors.accent.default }}>
              {lineDelta}
              {lineDelta !== 'modified' ? ' lines' : ''}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRefresh()
              }}
              className="flex items-center justify-center rounded hover:opacity-80"
              style={{
                width: 22,
                height: 22,
                color: colors.accent.default,
                cursor: 'pointer',
                backgroundColor: 'transparent',
                border: 'none'
              }}
              aria-label="Refresh file"
              title="Refresh file"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </CardShell>
  )
}

export default memo(FileViewCard)
