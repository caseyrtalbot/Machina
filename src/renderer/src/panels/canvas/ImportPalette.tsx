import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useEditorStore } from '../../store/editor-store'
import { useCanvasStore } from '../../store/canvas-store'
import {
  buildIdToPath,
  collectUniqueTags,
  computeImportNodes,
  computeImportViewport,
  computeOriginOffset,
  graphToCanvas,
  IMPORT_CAP,
  HUB_COUNT,
  type ImportMode
} from './import-logic'
import { colors, borderRadius } from '../../design/tokens'

interface ImportPaletteProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onImport: (execute: () => void, undo: () => void) => void
  readonly containerWidth: number
  readonly containerHeight: number
}

export function ImportPalette({
  open,
  onClose,
  onImport,
  containerWidth,
  containerHeight
}: ImportPaletteProps): React.ReactElement | null {
  const [searchQuery, setSearchQuery] = useState('')
  const [neighborhoodExpanded, setNeighborhoodExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const graph = useVaultStore((s) => s.graph)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifacts = useVaultStore((s) => s.artifacts)
  const activeNoteId = useEditorStore((s) => s.activeNoteId)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when palette opens
      setSearchQuery('')
      setNeighborhoodExpanded(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const activeTitle = useMemo(() => {
    if (!activeNoteId) return null
    const artifact = artifacts.find((a) => a.id === activeNoteId)
    return artifact?.title ?? activeNoteId.split('/').pop()?.replace('.md', '') ?? 'Note'
  }, [activeNoteId, artifacts])

  const neighborhoodCounts = useMemo(() => {
    if (!neighborhoodExpanded || !activeNoteId) return []
    return [1, 2, 3].map((depth) => {
      const result = computeImportNodes(graph, artifacts, {
        mode: 'neighborhood',
        activeNodeId: activeNoteId,
        depth
      })
      return { depth, count: Math.min(result.nodes.length, IMPORT_CAP) }
    })
  }, [neighborhoodExpanded, activeNoteId, graph, artifacts])

  const tags = useMemo(() => collectUniqueTags(artifacts), [artifacts])

  const filteredTags = useMemo(() => {
    if (!searchQuery) return tags
    const q = searchQuery.toLowerCase()
    return tags.filter((t) => t.tag.toLowerCase().includes(q))
  }, [tags, searchQuery])

  const hubCount = useMemo(() => Math.min(graph.nodes.length, HUB_COUNT), [graph.nodes])

  const handleImport = useCallback(
    (mode: ImportMode) => {
      const imported = computeImportNodes(graph, artifacts, mode)
      if (imported.nodes.length === 0) return

      const idToPath = buildIdToPath(fileToId)
      const existingNodes = useCanvasStore.getState().nodes
      const originX = computeOriginOffset(existingNodes)
      const { nodes: canvasNodes, edges: canvasEdges } = graphToCanvas(
        imported.nodes,
        imported.edges,
        idToPath,
        { x: originX, y: 0 }
      )

      const viewport = computeImportViewport(canvasNodes, containerWidth, containerHeight)
      const nodeIds = canvasNodes.map((n) => n.id)

      const executeFn = (): void => {
        const store = useCanvasStore.getState()
        for (const node of canvasNodes) store.addNode(node)
        for (const edge of canvasEdges) store.addEdge(edge)
        store.setViewport(viewport)
      }

      const undoFn = (): void => {
        const store = useCanvasStore.getState()
        for (const id of nodeIds) store.removeNode(id)
      }

      onImport(executeFn, undoFn)
      onClose()
    },
    [graph, artifacts, fileToId, containerWidth, containerHeight, onImport, onClose]
  )

  if (!open) return null

  const isEmpty = graph.nodes.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        background: 'rgba(0, 0, 0, 0.4)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 420,
          maxHeight: 480,
          background: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`,
          borderRadius: borderRadius.container,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: `1px solid ${colors.border.subtle}`
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter tags..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: colors.text.primary,
              fontSize: 14
            }}
          />
          <kbd
            style={{
              fontSize: 11,
              color: colors.text.muted,
              background: 'rgba(255, 255, 255, 0.06)',
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${colors.border.subtle}`
            }}
          >
            {'\u2318'}G
          </kbd>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {isEmpty ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: colors.text.muted,
                fontSize: 13
              }}
            >
              No notes indexed yet
            </div>
          ) : (
            <>
              {/* Neighborhood */}
              <PaletteRow
                disabled={!activeNoteId}
                onClick={() => setNeighborhoodExpanded((v) => !v)}
              >
                <span style={{ marginRight: 6, fontSize: 10 }}>
                  {neighborhoodExpanded ? '\u25BE' : '\u25B6'}
                </span>
                <span>
                  Neighborhood of{' '}
                  <span style={{ color: colors.accent.default }}>
                    {activeTitle ?? 'no active note'}
                  </span>
                </span>
              </PaletteRow>

              {neighborhoodExpanded &&
                activeNoteId &&
                neighborhoodCounts.map(({ depth, count }) => (
                  <PaletteRow
                    key={depth}
                    indent
                    onClick={() =>
                      handleImport({
                        mode: 'neighborhood',
                        activeNodeId: activeNoteId,
                        depth
                      })
                    }
                  >
                    <span style={{ color: colors.text.secondary }}>
                      {depth} hop{depth > 1 ? 's' : ''}
                    </span>
                    <CountBadge count={count} />
                  </PaletteRow>
                ))}

              <Separator />

              {/* Hub Notes */}
              <PaletteRow onClick={() => handleImport({ mode: 'hub' })}>
                <span>Hub Notes (top {HUB_COUNT})</span>
                <CountBadge count={hubCount} />
              </PaletteRow>

              <Separator />

              {/* Tags */}
              {filteredTags.map(({ tag, count }) => {
                const cappedCount = Math.min(count, IMPORT_CAP)
                const isCapped = count > IMPORT_CAP
                return (
                  <PaletteRow key={tag} onClick={() => handleImport({ mode: 'tag', tag })}>
                    <span>
                      Tag: <span style={{ color: colors.accent.default }}>#{tag}</span>
                    </span>
                    <CountBadge
                      count={cappedCount}
                      suffix={isCapped ? ` of ${count}` : undefined}
                    />
                  </PaletteRow>
                )
              })}

              {filteredTags.length === 0 && searchQuery && (
                <div style={{ padding: '12px 16px', color: colors.text.muted, fontSize: 13 }}>
                  No matching tags
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PaletteRow({
  children,
  onClick,
  disabled = false,
  indent = false
}: {
  readonly children: React.ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly indent?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: `6px ${indent ? 28 : 14}px`,
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? colors.text.muted : colors.text.primary,
        fontSize: 13,
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function CountBadge({
  count,
  suffix
}: {
  readonly count: number
  readonly suffix?: string
}): React.ReactElement {
  return (
    <span
      style={{
        fontSize: 11,
        color: colors.text.muted,
        background: colors.accent.muted,
        padding: '1px 7px',
        borderRadius: 10,
        marginLeft: 'auto',
        flexShrink: 0
      }}
    >
      {suffix ? `(${count}${suffix})` : count}
    </span>
  )
}

function Separator(): React.ReactElement {
  return (
    <div
      style={{
        height: 1,
        margin: '4px 14px',
        background: colors.border.subtle
      }}
    />
  )
}
