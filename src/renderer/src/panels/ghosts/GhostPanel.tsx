import { useState, useMemo, useCallback, useRef, useEffect, useId } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useUiStore } from '../../store/ui-store'
import { useDockStore } from '../../store/dock-store'
import { useGraphViewStore } from '../../store/graph-view-store'
import { useGhostEmerge } from '../../hooks/useGhostEmerge'
import type { GhostEntry } from '../../engine/ghost-index'
import { colors, transitions, typography, borderRadius, floatingPanel } from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { CheckCircleIcon, EmptyState } from '../../components/emptystate/EmptyState'
import { PanelHeader } from '../../components/panelheader/PanelHeader'
import { Spinner } from '../../components/emptystate/Spinner'
import { groupByFrequency } from './ghost-sections'

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
  const titleId = useId()

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
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 320,
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
        background: 'rgba(14, 16, 22, 0.96)',
        backdropFilter: floatingPanel.glass.blur,
        border: '1px solid var(--line-default)',
        borderRadius: borderRadius.card,
        padding: '12px 16px',
        boxShadow: floatingPanel.shadow,
        zIndex: 100
      }}
    >
      <div
        id={titleId}
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
          <div
            style={{ fontSize: 12, fontWeight: 500, color: colors.text.primary, marginBottom: 2 }}
          >
            {ref.fileTitle}
          </div>
          <div style={{ fontSize: 11, color: colors.text.secondary, lineHeight: 1.45 }}>
            {ref.context}
          </div>
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
  return (
    <button
      ref={buttonRef}
      type="button"
      className="ghost-action-icon"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: borderRadius.tool,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        padding: 0
      }}
    >
      {children}
      <span
        className="ghost-action-icon__tip"
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 11,
          color: colors.text.primary,
          background: 'rgba(20, 22, 28, 0.95)',
          border: '1px solid var(--line-default)',
          padding: '3px 8px',
          borderRadius: borderRadius.tool,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          backdropFilter: 'blur(12px)',
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
  readonly onDismiss: () => void
}

function GhostRow({ ghost, maxCount, onDismiss }: GhostRowProps) {
  const [contextOpen, setContextOpen] = useState(false)
  const contextBtnRef = useRef<HTMLButtonElement>(null)
  const { emerge, isEmerging } = useGhostEmerge()

  const barWidth = `${Math.round((ghost.referenceCount / maxCount) * 100)}%`

  const handleCreate = useCallback(async () => {
    if (isEmerging) return

    const pathById = useVaultStore.getState().artifactPathById
    const refPaths = ghost.references.map((r) => pathById[r.sourceId] ?? '').filter(Boolean)

    await emerge(ghost.id, ghost.id, refPaths)
  }, [ghost, emerge, isEmerging])

  const handleShowGraph = useCallback(() => {
    useDockStore.getState().openOrFocusDockTab({ kind: 'graph' })
    useGraphViewStore.getState().setSelectedNode(ghost.id)
  }, [ghost.id])

  return (
    <div
      className="ghost-row"
      onClick={() => setContextOpen((prev) => !prev)}
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
          borderRadius: 0,
          overflow: 'hidden',
          flexShrink: 0
        }}
      >
        <div
          style={{
            width: barWidth,
            height: '100%',
            background: colors.accent.default,
            borderRadius: 0,
            opacity: 0.5
          }}
        />
      </div>

      {/* Name */}
      <span
        className="ghost-row__name"
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 400,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {ghost.id}
      </span>

      {/* Actions (hover-reveal). Clicks stop here so they don't toggle the row popup. */}
      <div
        className="ghost-row__actions"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          gap: 4,
          position: 'absolute',
          right: 0,
          background: 'linear-gradient(90deg, transparent, var(--color-bg-base) 12px)',
          paddingLeft: 16
        }}
      >
        <ActionIcon label={isEmerging ? 'Creating…' : 'Create note'} onClick={handleCreate}>
          {isEmerging ? <Spinner size={14} /> : <IconPlus />}
        </ActionIcon>
        <ActionIcon label="Show in graph" onClick={handleShowGraph}>
          <IconGraph />
        </ActionIcon>
        <ActionIcon
          label="See references"
          buttonRef={contextBtnRef}
          onClick={() => setContextOpen((prev) => !prev)}
        >
          <IconThinking />
        </ActionIcon>
        <ActionIcon label="Dismiss" onClick={onDismiss}>
          <IconDismiss />
        </ActionIcon>
      </div>

      {/* Count (hidden on hover) */}
      <span
        className="ghost-row__count"
        style={{
          fontSize: 11,
          color: colors.text.muted,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 18,
          textAlign: 'right' as const
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

function AllResolvedState() {
  return (
    <div className="h-full" style={{ color: colors.text.muted, backgroundColor: colors.bg.base }}>
      <EmptyState
        icon={<CheckCircleIcon />}
        maxWidth={200}
        body={
          <span style={{ color: colors.text.muted }}>
            All references resolved.
            <br />
            Your vault is fully connected.
          </span>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// GhostPanel (Main Export)
// ---------------------------------------------------------------------------

export function GhostPanel() {
  // Memoized once per worker result in vault-store — no per-panel rebuilds.
  const allGhosts = useVaultStore((s) => s.ghostIndex)
  const dismissedGhosts = useUiStore((s) => s.dismissedGhosts)
  const dismissGhost = useUiStore((s) => s.dismissGhost)
  const undismissGhost = useUiStore((s) => s.undismissGhost)

  const visibleGhosts = useMemo(
    () => allGhosts.filter((g) => !dismissedGhosts.includes(g.id)),
    [allGhosts, dismissedGhosts]
  )
  const dismissedEntries = useMemo(
    () => allGhosts.filter((g) => dismissedGhosts.includes(g.id)),
    [allGhosts, dismissedGhosts]
  )

  const sections = useMemo(() => groupByFrequency(visibleGhosts), [visibleGhosts])
  const totalCount = visibleGhosts.length
  const maxCount = visibleGhosts[0]?.referenceCount ?? 1

  if (visibleGhosts.length === 0 && dismissedEntries.length === 0) {
    return <AllResolvedState />
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        fontFamily: typography.fontFamily.body,
        backgroundColor: colors.bg.base
      }}
    >
      <div
        style={{
          maxWidth: '52rem',
          margin: '0 auto',
          padding: '2rem 2rem 3rem'
        }}
      >
        <PanelHeader
          variant="masthead"
          title="Unresolved References"
          display={totalCount}
          subtitle={`ghost${totalCount !== 1 ? 's' : ''} across your vault`}
        />

        {/* Sections */}
        {sections.map((section) => (
          <div key={section.label}>
            <SectionLabel
              as="div"
              style={{
                color: colors.text.primary,
                padding: '12px 0 8px',
                borderBottom: '1px solid var(--line-faint)',
                marginBottom: 4
              }}
            >
              {section.label}
            </SectionLabel>
            {section.ghosts.map((ghost) => (
              <GhostRow
                key={ghost.id}
                ghost={ghost}
                maxCount={maxCount}
                onDismiss={() => dismissGhost(ghost.id)}
              />
            ))}
          </div>
        ))}

        {/* Dismissed ghosts: restorable, kept out of graph + sections */}
        {dismissedEntries.length > 0 && (
          <div>
            <SectionLabel
              as="div"
              style={{
                color: colors.text.muted,
                padding: '12px 0 8px',
                borderBottom: '1px solid var(--line-faint)',
                marginBottom: 4
              }}
            >
              Dismissed ({dismissedEntries.length})
            </SectionLabel>
            {dismissedEntries.map((ghost) => (
              <div
                key={ghost.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 0',
                  gap: 10
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: colors.text.muted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {ghost.id}
                </span>
                <button
                  type="button"
                  onClick={() => undismissGhost(ghost.id)}
                  className="cursor-pointer"
                  style={{
                    fontSize: 11,
                    color: colors.text.secondary,
                    border: '1px solid var(--line-faint)',
                    borderRadius: borderRadius.tool,
                    padding: '2px 8px',
                    background: 'transparent',
                    transition: `color ${transitions.focusRing}`
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
