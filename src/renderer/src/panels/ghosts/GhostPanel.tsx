import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useUiStore } from '../../store/ui-store'
import { useTabStore, TAB_DEFINITIONS } from '../../store/tab-store'
import { useGraphViewStore } from '../../store/graph-view-store'
import { useGhostEmerge } from '../../hooks/useGhostEmerge'
import { buildGhostIndex, type GhostEntry } from '../../engine/ghost-index'
import { colors, typography } from '../../design/tokens'
import { groupByFrequency } from './ghost-sections'
import type { Artifact } from '@shared/types'

// ---------------------------------------------------------------------------
// SVG Icons (14x14 viewBox 0 0 16 16)
// ---------------------------------------------------------------------------

function IconPlus() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  )
}

function IconGraph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconThinking() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M6 9.5c.5.8 1.2 1.2 2 1.2s1.5-.4 2-1.2" />
    </svg>
  )
}

function IconDismiss() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Context Popup
// ---------------------------------------------------------------------------

interface ContextPopupProps {
  readonly ghost: GhostEntry
  readonly anchorRef: React.RefObject<HTMLButtonElement | null>
  readonly onClose: () => void
}

function ContextPopup({ ghost, anchorRef, onClose }: ContextPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      const popupHeight = 240 // estimated max
      const fitsAbove = rect.top > popupHeight + 8
      setPos({
        top: fitsAbove ? rect.top - popupHeight - 8 : rect.bottom + 8,
        left: Math.max(8, rect.right - 320)
      })
    }
  }, [anchorRef])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchorRef, onClose])

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={`${ghost.id} references`}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 320,
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
        background: 'rgba(14, 16, 22, 0.96)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        zIndex: 100
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: colors.text.primary,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        <span style={{ opacity: 0.5 }}>
          <IconThinking />
        </span>
        {ghost.id} &middot; {ghost.referenceCount} reference
        {ghost.referenceCount !== 1 ? 's' : ''}
      </div>
      {ghost.references.map((ref, i) => (
        <div
          key={i}
          style={{
            padding: '6px 0',
            borderBottom:
              i < ghost.references.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none'
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: '#c0c7d0', marginBottom: 2 }}>
            {ref.fileTitle}
          </div>
          <div style={{ fontSize: 11, color: '#5a6070', lineHeight: 1.45 }}>{ref.context}</div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action Icon Button
// ---------------------------------------------------------------------------

interface ActionIconProps {
  readonly label: string
  readonly onClick: (e: React.MouseEvent) => void
  readonly children: React.ReactNode
  readonly buttonRef?: React.RefObject<HTMLButtonElement | null>
}

function ActionIcon({ label, onClick, children, buttonRef }: ActionIconProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        border: 'none',
        background: hovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        color: hovered ? '#c0c7d0' : '#5a6070',
        cursor: 'pointer',
        transition: 'background 100ms ease, color 100ms ease',
        position: 'relative',
        padding: 0
      }}
    >
      {children}
      <span
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 11,
          color: '#c0c7d0',
          background: 'rgba(20, 22, 28, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '3px 8px',
          borderRadius: 5,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 100ms ease',
          backdropFilter: 'blur(8px)',
          zIndex: 50
        }}
      >
        {label}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Ghost Row
// ---------------------------------------------------------------------------

interface GhostRowProps {
  readonly ghost: GhostEntry
  readonly maxCount: number
  readonly artifacts: readonly Artifact[]
  readonly onDismiss: () => void
}

function GhostRow({ ghost, maxCount, artifacts, onDismiss }: GhostRowProps) {
  const [hovered, setHovered] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const contextBtnRef = useRef<HTMLButtonElement>(null)
  const { emerge, isEmerging } = useGhostEmerge()

  const barWidth = `${Math.round((ghost.referenceCount / maxCount) * 100)}%`

  const handleCreate = useCallback(async () => {
    if (isEmerging) return

    const refPaths = artifacts
      .filter((a) => ghost.references.some((r) => r.fileTitle === a.title))
      .map((a) => {
        const pathById = useVaultStore.getState().artifactPathById
        return pathById[a.id] ?? ''
      })
      .filter(Boolean)

    await emerge(ghost.id, ghost.id, refPaths)
  }, [ghost, artifacts, emerge, isEmerging])

  const handleShowGraph = useCallback(() => {
    const def = TAB_DEFINITIONS.graph
    useTabStore.getState().openTab({
      id: 'graph',
      type: 'graph',
      label: def.label,
      closeable: true
    })
    useGraphViewStore.getState().setSelectedNode(ghost.id)
  }, [ghost.id])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 0',
        gap: 10,
        cursor: 'pointer',
        position: 'relative'
      }}
    >
      {/* Frequency bar */}
      <div
        style={{
          width: 32,
          height: 3,
          background: 'rgba(255, 255, 255, 0.04)',
          borderRadius: 2,
          overflow: 'hidden',
          flexShrink: 0
        }}
      >
        <div
          style={{
            width: barWidth,
            height: '100%',
            background: colors.accent.default,
            borderRadius: 2,
            opacity: 0.5
          }}
        />
      </div>

      {/* Name */}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: hovered ? colors.text.primary : '#a0a8b5',
          fontWeight: 400,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'color 120ms ease'
        }}
      >
        {ghost.id}
      </span>

      {/* Actions (hover-reveal) */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 100ms ease',
          position: 'absolute',
          right: 0,
          background: 'linear-gradient(90deg, transparent, var(--color-bg-base) 12px)',
          paddingLeft: 16
        }}
      >
        <ActionIcon label="Create note" onClick={handleCreate}>
          <IconPlus />
        </ActionIcon>
        <ActionIcon label="Show in graph" onClick={handleShowGraph}>
          <IconGraph />
        </ActionIcon>
        <ActionIcon
          label="See references"
          buttonRef={contextBtnRef}
          onClick={(e) => {
            e.stopPropagation()
            setContextOpen((prev) => !prev)
          }}
        >
          <IconThinking />
        </ActionIcon>
        <ActionIcon label="Dismiss" onClick={onDismiss}>
          <IconDismiss />
        </ActionIcon>
      </div>

      {/* Count (hidden on hover) */}
      <span
        style={{
          fontSize: 11,
          color: '#3e4550',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 18,
          textAlign: 'right' as const,
          opacity: hovered ? 0 : 1,
          transition: 'opacity 100ms ease'
        }}
      >
        {ghost.referenceCount}
      </span>

      {/* Context popup */}
      {contextOpen && (
        <ContextPopup
          ghost={ghost}
          anchorRef={contextBtnRef}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GhostPanel (Main Export)
// ---------------------------------------------------------------------------

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

  const sections = useMemo(() => groupByFrequency(visibleGhosts), [visibleGhosts])
  const totalCount = visibleGhosts.length
  const maxCount = visibleGhosts[0]?.referenceCount ?? 1

  if (visibleGhosts.length === 0) {
    return <EmptyState hasDismissed={dismissedGhosts.length > 0} />
  }

  return (
    <div className="h-full overflow-y-auto" style={{ fontFamily: typography.fontFamily.body }}>
      <div
        style={{
          maxWidth: '52rem',
          margin: '0 auto',
          padding: '2rem 2rem 3rem'
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{ fontSize: 13, fontWeight: 300, color: colors.text.primary, marginBottom: 2 }}
          >
            Unresolved References
          </div>
          <div
            style={{
              fontSize: 48,
              fontWeight: 200,
              color: colors.text.primary,
              letterSpacing: '-0.03em',
              lineHeight: 1.1
            }}
          >
            {totalCount}
          </div>
          <div style={{ fontSize: 12, color: colors.text.primary }}>
            ghost{totalCount !== 1 ? 's' : ''} across your vault
          </div>
        </div>

        {/* Sections */}
        {sections.map((section) => (
          <div key={section.label}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                color: colors.text.primary,
                padding: '14px 0 6px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                marginBottom: 2
              }}
            >
              {section.label}
            </div>
            {section.ghosts.map((ghost) => (
              <GhostRow
                key={ghost.id}
                ghost={ghost}
                maxCount={maxCount}
                artifacts={artifacts}
                onDismiss={() => dismissGhost(ghost.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
