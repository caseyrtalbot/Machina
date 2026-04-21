import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { colors, floatingPanel, typography } from '../../design/tokens'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { AgentActionName } from '@shared/agent-action-types'
import type { StreamState } from './agent-stream-state'

interface AgentThoughtCardProps {
  readonly streamState: StreamState
  readonly actionName: AgentActionName | null
  readonly anchor: { x: number; y: number }
  readonly startedAt: number
  readonly onCancel: () => void
}

const CARD_WIDTH = 440
const MIN_HEIGHT = 120
const MAX_HEIGHT_PX = 400

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function phaseLabel(
  phase: StreamState['phase'],
  action: AgentActionName | null,
  opCount: number | null
): string {
  switch (phase) {
    case 'starting':
      return action ? `Starting ${action}` : 'Starting agent'
    case 'thinking':
      return 'Thinking'
    case 'drafting':
      return 'Drafting ops'
    case 'materializing':
      return opCount != null
        ? `Materializing · ${opCount} op${opCount === 1 ? '' : 's'}`
        : 'Materializing'
  }
}

export function AgentThoughtCard({
  streamState,
  actionName,
  anchor,
  startedAt,
  onCancel
}: AgentThoughtCardProps) {
  const [now, setNow] = useState(() => Date.now())
  const bodyRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const reducedMotion = useReducedMotion()
  const titleId = useId()

  // Elapsed timer — tick every 500ms during active phases
  useEffect(() => {
    if (streamState.phase === 'materializing') return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [streamState.phase])

  // Escape key cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  // Auto-scroll to bottom during streaming, unless user scrolled up
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (userScrolledUp.current) return
    if (reducedMotion) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [streamState.thinking, streamState.visibleText, reducedMotion])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    userScrolledUp.current = !atBottom
  }

  // Clamp width to viewport
  const viewportW = typeof window === 'undefined' ? CARD_WIDTH : window.innerWidth
  const width = Math.min(CARD_WIDTH, Math.max(240, viewportW - 48))
  const maxHeight = Math.min(
    MAX_HEIGHT_PX,
    Math.floor((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.5)
  )

  // Anchor is the card's intended top-left corner in screen coordinates.
  const left = Math.round(anchor.x)
  const top = Math.round(anchor.y)

  const containerStyle: CSSProperties = {
    position: 'fixed',
    left,
    top,
    width,
    minHeight: MIN_HEIGHT,
    maxHeight,
    zIndex: 1100,
    backgroundColor: floatingPanel.glass.bg,
    backdropFilter: floatingPanel.glass.blur,
    WebkitBackdropFilter: floatingPanel.glass.blur,
    borderRadius: floatingPanel.borderRadius,
    boxShadow: floatingPanel.shadow,
    fontFamily: typography.fontFamily.body,
    color: colors.text.primary,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: reducedMotion
      ? 'opacity 150ms ease-out'
      : 'opacity 200ms ease-out, transform 200ms ease-out'
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: `1px solid ${colors.border.subtle}`,
    fontSize: 12,
    color: colors.text.secondary
  }

  const bodyStyle: CSSProperties = {
    padding: 14,
    overflowY: 'auto',
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    flex: 1
  }

  const cancelBtnStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    color: colors.text.muted,
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    marginLeft: 8
  }

  const thinkingDimStyle: CSSProperties = {
    opacity: streamState.phase === 'drafting' || streamState.phase === 'materializing' ? 0.4 : 1,
    fontStyle: 'italic',
    color: colors.text.secondary,
    marginBottom: streamState.visibleText ? 8 : 0
  }

  const elapsed = formatElapsed(now - startedAt)
  const showTimer = streamState.phase !== 'materializing'

  return (
    <div style={containerStyle} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div style={headerStyle} aria-live="polite">
        <span id={titleId}>
          {phaseLabel(streamState.phase, actionName, streamState.opCount)}
          {showTimer && (
            <span style={{ marginLeft: 8, color: colors.text.muted }}>· {elapsed}</span>
          )}
        </span>
        <button
          type="button"
          aria-label="Cancel agent action"
          onClick={onCancel}
          onMouseOver={(e) => {
            e.currentTarget.style.color = colors.text.primary
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = colors.text.muted
          }}
          style={cancelBtnStyle}
        >
          ×
        </button>
      </div>
      <div
        ref={bodyRef}
        role="log"
        aria-live="polite"
        aria-atomic={false}
        onScroll={onScroll}
        style={bodyStyle}
      >
        {streamState.phase === 'starting' && !streamState.thinking && <PulseIndicator />}
        {streamState.thinking && <div style={thinkingDimStyle}>{streamState.thinking}</div>}
        {streamState.visibleText && <div>{streamState.visibleText}</div>}
      </div>
    </div>
  )
}

function PulseIndicator() {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: colors.text.muted,
        padding: '8px 0'
      }}
    >
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </div>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        backgroundColor: 'currentColor',
        opacity: 0.4,
        animation: `te-pulse 900ms ${delay}ms ease-in-out infinite`
      }}
    />
  )
}
