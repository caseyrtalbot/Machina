import { useState, useMemo, useCallback } from 'react'
import { useVaultStore } from '@renderer/store/vault-store'
import { useGraphViewStore } from '@renderer/store/graph-view-store'
import { useUiStore } from '@renderer/store/ui-store'
import { openNoteInEditor } from '@renderer/store/dock-store'
import { useGhostEmerge } from '../../hooks/useGhostEmerge'
import { getArtifactColor } from '../../design/tokens'
import type { Artifact } from '@shared/types'

const MAX_BODY_CHARS = 480

function BodyPreview({ body }: { body: string }) {
  if (!body.trim()) return null
  const truncated =
    body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS).trim() + '...' : body.trim()
  return <p className="te-graph-drawer__body">{truncated}</p>
}

function BacklinksList({
  backlinks,
  onNavigate
}: {
  backlinks: readonly Artifact[]
  onNavigate: (id: string) => void
}) {
  if (backlinks.length === 0) return null
  return (
    <div>
      <div className="te-graph-drawer__section-label">Backlinks</div>
      <div className="te-graph-drawer__list">
        {backlinks.slice(0, 8).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onNavigate(a.id)}
            className="te-graph-drawer__link interactive-hover"
          >
            <span
              className="te-graph-drawer__dot"
              style={{ backgroundColor: getArtifactColor(a.type) }}
            />
            {a.title}
          </button>
        ))}
        {backlinks.length > 8 && (
          <span className="te-graph-drawer__more">+{backlinks.length - 8} more</span>
        )}
      </div>
    </div>
  )
}

export function GraphDetailDrawer() {
  const selectedNodeId = useGraphViewStore((s) => s.selectedNodeId)
  const setSelectedNode = useGraphViewStore((s) => s.setSelectedNode)
  const artifacts = useVaultStore((s) => s.artifacts)
  const artifactPathById = useVaultStore((s) => s.artifactPathById)
  const getBacklinks = useVaultStore((s) => s.getBacklinks)

  // "Sticky" ID: holds the last non-null selection so drawer content
  // persists during the exit slide animation
  const [displayId, setDisplayId] = useState<string | null>(null)
  if (selectedNodeId !== null && selectedNodeId !== displayId) {
    setDisplayId(selectedNodeId)
  }

  const isOpen = selectedNodeId !== null

  const { artifact, backlinks, filePath } = useMemo(() => {
    if (!displayId) return { artifact: null, backlinks: [] as Artifact[], filePath: null }
    const a = artifacts.find((x) => x.id === displayId) ?? null
    return {
      artifact: a,
      backlinks: a ? getBacklinks(displayId) : ([] as Artifact[]),
      filePath: artifactPathById[displayId] ?? null
    }
  }, [displayId, artifacts, artifactPathById, getBacklinks])

  const handleOpenInEditor = () => {
    if (!artifact || !filePath) return
    openNoteInEditor(filePath)
  }

  const handleNavigateBacklink = (id: string) => {
    const path = artifactPathById[id]
    if (path) {
      openNoteInEditor(path)
    }
  }

  return (
    <div className="te-graph-drawer" data-open={isOpen}>
      {artifact ? (
        <>
          {/* Header: title + type */}
          <div>
            <div className="te-graph-drawer__header-row">
              <h3 className="te-graph-drawer__title">{artifact.title}</h3>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="te-graph-drawer__close interactive-hover"
                title="Close drawer"
                aria-label="Close drawer"
              >
                ×
              </button>
            </div>
            <div className="te-graph-drawer__type-row">
              <span
                className="te-graph-drawer__type-dot"
                style={{ backgroundColor: getArtifactColor(artifact.type) }}
              />
              <span className="te-graph-drawer__type-label">{artifact.type}</span>
            </div>
          </div>

          {/* Tags */}
          {artifact.tags.length > 0 && (
            <div className="te-graph-drawer__tags">
              {artifact.tags.map((tag) => (
                <span key={tag} className="te-graph-drawer__tag">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Open in editor */}
          {filePath && (
            <button
              type="button"
              onClick={handleOpenInEditor}
              className="te-graph-drawer__editor-btn interactive-hover"
            >
              Open in editor
            </button>
          )}

          {/* Body preview */}
          <BodyPreview body={artifact.body} />

          {/* Backlinks */}
          <BacklinksList backlinks={backlinks} onNavigate={handleNavigateBacklink} />
        </>
      ) : displayId ? (
        <GhostDrawerContent ghostId={displayId} onClose={() => setSelectedNode(null)} />
      ) : null}
    </div>
  )
}

function GhostDrawerContent({
  ghostId,
  onClose
}: {
  readonly ghostId: string
  readonly onClose: () => void
}) {
  // Memoized once per worker result in vault-store — no per-drawer rebuilds.
  const ghostIndex = useVaultStore((s) => s.ghostIndex)
  const dismissGhost = useUiStore((s) => s.dismissGhost)
  const { emerge, isEmerging } = useGhostEmerge()

  const ghostEntry = useMemo(
    () => ghostIndex.find((g) => g.id === ghostId) ?? null,
    [ghostIndex, ghostId]
  )

  const handleCreate = useCallback(async () => {
    const pathById = useVaultStore.getState().artifactPathById
    const refPaths = (ghostEntry?.references ?? [])
      .map((r) => pathById[r.sourceId] ?? '')
      .filter(Boolean)

    await emerge(ghostId, ghostId, refPaths)
  }, [ghostId, ghostEntry, emerge])

  return (
    <>
      <div>
        <div className="te-graph-drawer__header-row">
          <h3 className="te-graph-drawer__title">{ghostId}</h3>
          <button
            type="button"
            onClick={onClose}
            className="te-graph-drawer__close interactive-hover"
            title="Close drawer"
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>
        <div className="te-graph-drawer__meta">
          Ghost node · {ghostEntry?.referenceCount ?? 0} reference
          {(ghostEntry?.referenceCount ?? 0) !== 1 ? 's' : ''}
        </div>
      </div>

      {ghostEntry && ghostEntry.references.length > 0 && (
        <div>
          <div className="te-graph-drawer__section-label">Referenced by</div>
          <div className="te-graph-drawer__ref-list">
            {ghostEntry.references.map((ref, i) => (
              <div key={i} className="te-graph-drawer__ref">
                <div className="te-graph-drawer__ref-title">{ref.fileTitle}</div>
                <div className="te-graph-drawer__ref-context">{ref.context}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="te-graph-drawer__actions">
        <button
          type="button"
          onClick={handleCreate}
          disabled={isEmerging}
          className="te-graph-drawer__ghost-btn interactive-hover"
        >
          {isEmerging ? 'Creating...' : 'Create File'}
        </button>
        <button
          type="button"
          onClick={() => dismissGhost(ghostId)}
          className="te-graph-drawer__dismiss-btn interactive-hover"
        >
          Dismiss
        </button>
      </div>
    </>
  )
}
