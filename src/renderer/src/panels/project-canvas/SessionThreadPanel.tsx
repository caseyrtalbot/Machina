import { useEffect, useRef, useState, useCallback } from 'react'
import type { SessionThreadState } from '../../hooks/useSessionThread'
import type { SessionMilestone, SessionToolEvent } from '@shared/project-canvas-types'
import { colors, typography } from '../../design/tokens'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionThreadPanelProps {
  readonly state: SessionThreadState
  readonly onFileClick: (filePath: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMESTAMP_INTERVAL_MS = 5000

const TYPE_ICONS: Record<SessionMilestone['type'], string> = {
  edit: '\u270E',
  command: '\u25B6',
  research: '\u25C9',
  create: '\u271A',
  error: '\u2715',
  'session-switched': '\u21BB'
}

const TYPE_COLORS: Record<SessionMilestone['type'], string> = {
  edit: '#94a3b8',
  command: '#a78bfa',
  research: '#22d3ee',
  create: '#4ade80',
  error: '#ef4444',
  'session-switched': '#64748b'
}

const TOOL_ICONS: Record<SessionToolEvent['tool'], string> = {
  Read: '\u25B7',
  Write: '\u25CF',
  Edit: '\u270E',
  Bash: '\u2588',
  Grep: '\u2315'
}

// ---------------------------------------------------------------------------
// Relative timestamp formatting
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp)
  if (delta < 5000) return 'now'
  if (delta < 60000) return `${Math.floor(delta / 1000)}s`
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m`
  return `${Math.floor(delta / 3600000)}h`
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

function StatusDot({ isLive, hasMilestones }: { isLive: boolean; hasMilestones: boolean }) {
  const color = isLive ? '#4ade80' : hasMilestones ? '#64748b' : '#ef4444'
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: color,
        animation: isLive ? 'session-pulse 2s ease-in-out infinite' : undefined,
        flexShrink: 0
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Expanded event row
// ---------------------------------------------------------------------------

function EventRow({
  event,
  onFileClick
}: {
  event: SessionToolEvent
  onFileClick: (path: string) => void
}) {
  const icon = TOOL_ICONS[event.tool]
  const showFile = event.filePath != null
  const showDetail = event.detail != null

  return (
    <div style={{ paddingLeft: 20, paddingTop: 3, paddingBottom: 3 }}>
      <div className="flex items-start gap-1.5" style={{ fontSize: 11 }}>
        <span style={{ color: '#64748b', flexShrink: 0, width: 12, textAlign: 'center' }}>
          {icon}
        </span>
        {showFile ? (
          <span
            className="cursor-pointer truncate"
            style={{
              fontFamily: typography.fontFamily.mono,
              color: colors.text.secondary,
              fontSize: 11
            }}
            onClick={(e) => {
              e.stopPropagation()
              onFileClick(event.filePath!)
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#5cb8c4'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.text.secondary as string
            }}
            title={event.filePath}
          >
            {event.filePath}
          </span>
        ) : (
          <span
            style={{
              fontFamily: typography.fontFamily.mono,
              color: colors.text.muted,
              fontSize: 11
            }}
            className="truncate"
          >
            {event.tool === 'Bash' && event.detail ? event.detail : event.tool}
          </span>
        )}
      </div>
      {showDetail && event.tool !== 'Bash' && (
        <div
          className="truncate"
          style={{
            paddingLeft: 14,
            fontSize: 10,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            marginTop: 1
          }}
        >
          {event.detail}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Milestone row
// ---------------------------------------------------------------------------

function MilestoneRow({
  milestone,
  expanded,
  now,
  onToggle,
  onFileClick
}: {
  milestone: SessionMilestone
  expanded: boolean
  now: number
  onToggle: () => void
  onFileClick: (path: string) => void
}) {
  if (milestone.type === 'session-switched') {
    return (
      <div className="flex items-center gap-2" style={{ padding: '8px 0', opacity: 0.5 }}>
        <div style={{ flex: 1, height: 1, backgroundColor: colors.border.default }} />
        <span style={{ fontSize: 10, color: colors.text.muted, whiteSpace: 'nowrap' }}>
          New session detected
        </span>
        <div style={{ flex: 1, height: 1, backgroundColor: colors.border.default }} />
      </div>
    )
  }

  const icon = TYPE_ICONS[milestone.type]
  const iconColor = TYPE_COLORS[milestone.type]
  const timeStr = formatRelativeTime(milestone.timestamp, now)

  return (
    <div>
      <div
        className="flex items-center gap-2 cursor-pointer rounded"
        style={{
          padding: '6px 8px',
          transition: 'background-color 150ms ease-out'
        }}
        onClick={onToggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        <span
          style={{ fontSize: 12, color: iconColor, flexShrink: 0, width: 16, textAlign: 'center' }}
        >
          {icon}
        </span>
        <span className="truncate" style={{ flex: 1, fontSize: 12, color: colors.text.secondary }}>
          {milestone.summary}
        </span>
        <span
          style={{
            fontSize: 10,
            color: colors.text.muted,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
            marginLeft: 4
          }}
        >
          {timeStr}
        </span>
      </div>
      {expanded && milestone.events.length > 0 && (
        <div style={{ paddingBottom: 4 }}>
          {milestone.events.map((event, i) => (
            <EventRow key={i} event={event} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SessionThreadPanel
// ---------------------------------------------------------------------------

export function SessionThreadPanel({ state, onFileClick }: SessionThreadPanelProps) {
  const [now, setNow] = useState(Date.now)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtTopRef = useRef(true)

  // Refresh relative timestamps
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TIMESTAMP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll: when new milestones arrive and user is at the top, stay at top
  const prevCountRef = useRef(state.milestones.length)
  useEffect(() => {
    if (state.milestones.length > prevCountRef.current && isAtTopRef.current) {
      scrollRef.current?.scrollTo({ top: 0 })
    }
    prevCountRef.current = state.milestones.length
  }, [state.milestones.length])

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      isAtTopRef.current = scrollRef.current.scrollTop < 8
    }
  }, [])

  const hasMilestones = state.milestones.length > 0

  return (
    <div
      className="absolute flex flex-col rounded-lg"
      style={{
        right: 12,
        top: 48,
        width: 280,
        maxHeight: '70vh',
        zIndex: 15,
        backgroundColor: 'rgba(20, 20, 20, 0.92)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${colors.border.default}`,
        borderRadius: 8
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{
          padding: '10px 12px 8px',
          borderBottom: `1px solid ${colors.border.default}`
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.primary }}>
          Live Thread
        </span>
        <StatusDot isLive={state.isLive} hasMilestones={hasMilestones} />
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto"
        style={{
          flex: 1,
          padding: '4px 4px',
          scrollbarWidth: 'thin',
          scrollbarColor: `${colors.border.default} transparent`
        }}
      >
        {!hasMilestones ? (
          <div
            className="flex flex-col items-center justify-center"
            style={{ padding: '32px 16px' }}
          >
            <span style={{ fontSize: 12, color: colors.text.secondary }}>No active session</span>
            <span style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>
              Start Claude in the terminal
            </span>
          </div>
        ) : (
          state.milestones.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              milestone={milestone}
              expanded={state.expandedIds.has(milestone.id)}
              now={now}
              onToggle={() => state.toggle(milestone.id)}
              onFileClick={onFileClick}
            />
          ))
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes session-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
