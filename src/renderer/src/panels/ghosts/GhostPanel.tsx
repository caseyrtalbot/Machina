import { useState, useMemo, useCallback } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useUiStore } from '../../store/ui-store'
import { useTabStore, TAB_DEFINITIONS } from '../../store/tab-store'
import { useGraphViewStore } from '../../store/graph-view-store'
import { useGhostEmerge } from '../../hooks/useGhostEmerge'
import { buildGhostIndex, type GhostEntry } from '../../engine/ghost-index'
import { colors, floatingPanel, typography } from '../../design/tokens'
import type { Artifact } from '@shared/types'

export function GhostPanel() {
  const graph = useVaultStore((s) => s.graph)
  const artifacts = useVaultStore((s) => s.artifacts)
  const dismissedGhosts = useUiStore((s) => s.dismissedGhosts)
  const dismissGhost = useUiStore((s) => s.dismissGhost)

  const allGhosts = useMemo(() => buildGhostIndex(graph, artifacts), [graph, artifacts])

  const visibleGhosts = useMemo(
    () => allGhosts.filter((g) => !dismissedGhosts.includes(g.id)),
    [allGhosts, dismissedGhosts]
  )

  if (visibleGhosts.length === 0) {
    return <EmptyState hasDismissed={dismissedGhosts.length > 0} />
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        padding: '18px 16px 28px',
        fontFamily: typography.fontFamily.body
      }}
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.16em] mb-1"
            style={{ color: colors.text.muted }}
          >
            Ghosts
          </div>
          <div className="text-sm" style={{ color: colors.text.secondary, lineHeight: 1.5 }}>
            {visibleGhosts.length} unresolved reference{visibleGhosts.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div
          className="text-[11px] px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono
          }}
        >
          Create notes for already-mentioned ideas
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {visibleGhosts.map((ghost) => (
          <GhostCard
            key={ghost.id}
            ghost={ghost}
            artifacts={artifacts}
            onDismiss={() => dismissGhost(ghost.id)}
          />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ hasDismissed }: { readonly hasDismissed: boolean }) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-3"
      style={{ color: colors.text.muted }}
    >
      <svg
        width={32}
        height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.5 }}
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <div className="text-sm text-center" style={{ maxWidth: 200 }}>
        All references resolved.
        <br />
        Your vault is fully connected.
      </div>
      {hasDismissed && (
        <div className="text-xs mt-2" style={{ opacity: 0.5 }}>
          Some ghosts are dismissed
        </div>
      )}
    </div>
  )
}

function GhostCard({
  ghost,
  artifacts,
  onDismiss
}: {
  readonly ghost: GhostEntry
  readonly artifacts: readonly Artifact[]
  readonly onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { emerge, isEmerging } = useGhostEmerge()

  const handleCreate = useCallback(async () => {
    const refPaths = artifacts
      .filter((a) => ghost.references.some((r) => r.fileTitle === a.title))
      .map((a) => {
        const pathById = useVaultStore.getState().artifactPathById
        return pathById[a.id] ?? ''
      })
      .filter(Boolean)

    await emerge(ghost.id, ghost.id, refPaths)
  }, [ghost, artifacts, emerge])

  return (
    <div
      style={{
        backgroundColor: floatingPanel.glass.bg,
        borderRadius: 14,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        overflow: 'hidden',
        boxShadow: floatingPanel.shadowCompact
      }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer"
        style={{
          background: expanded
            ? 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))'
            : 'transparent',
          color: colors.text.primary,
          borderBottom: expanded ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="text-xs"
          style={{
            color: colors.text.muted,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform 150ms ease-out'
          }}
        >
          {'\u25B6'}
        </span>
        <span className="text-sm font-medium flex-1 text-left">{ghost.id}</span>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            color: colors.text.secondary
          }}
        >
          {ghost.referenceCount}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <div className="flex flex-col gap-1.5 mb-3">
            {ghost.references.map((ref, i) => (
              <div
                key={i}
                className="text-xs rounded px-2 py-1.5"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: colors.text.secondary
                }}
              >
                <div className="font-medium mb-0.5" style={{ color: colors.text.primary }}>
                  {ref.fileTitle}
                </div>
                <div style={{ opacity: 0.7, lineHeight: 1.4 }}>{ref.context}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs px-2.5 py-1 rounded cursor-pointer"
              style={{
                backgroundColor: colors.accent.default,
                color: '#0b0c10',
                fontWeight: 600,
                opacity: isEmerging ? 0.5 : 1
              }}
              onClick={handleCreate}
              disabled={isEmerging}
            >
              {isEmerging ? 'Creating...' : 'Create File'}
            </button>
            <button
              type="button"
              className="text-xs px-2.5 py-1 rounded cursor-pointer"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: colors.text.secondary
              }}
              onClick={() => {
                const def = TAB_DEFINITIONS.graph
                useTabStore.getState().openTab({
                  id: 'graph',
                  type: 'graph',
                  label: def.label,
                  closeable: true
                })
                useGraphViewStore.getState().setSelectedNode(ghost.id)
              }}
            >
              Show on graph
            </button>
            <button
              type="button"
              className="text-xs px-2.5 py-1 rounded cursor-pointer"
              style={{
                backgroundColor: 'transparent',
                color: colors.text.muted,
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
