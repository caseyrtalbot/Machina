/**
 * Breaker-tripped notice rows for the approvals tray (workstation Phase 2
 * step 6, contracts §5 v1.2.6). Self-contained: reads the breaker store,
 * refreshes on mount (the tray popover mounts it on open), renders nothing
 * with zero trips — the ApprovalsTray edit is a mount-only insertion.
 *
 * Copy stays inside the §4 containment framing: a kill contains an accident
 * faster; it is not judgment and not prevention — the writes that tripped
 * the breaker are already on disk and stay in the queue for review.
 */
import { useEffect } from 'react'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import { useAgentBreakerStore } from '../../store/agent-breaker-store'
import { borderRadius, colors, typography } from '../../design/tokens'

const REASON_LABEL: Record<BreakerTripEvent['reason'], string> = {
  velocity: 'sustained write velocity',
  'forbidden-writes': 'repeated protected-path writes',
  'head-moved': 'git history moved',
  'max-turns': 'turn budget exhausted',
  'max-spend': 'spend threshold crossed'
}

export function AgentBreakerNotices() {
  const trips = useAgentBreakerStore((s) => s.trips)
  const refresh = useAgentBreakerStore((s) => s.refresh)

  // Pull on mount: the popover can open after a trip the push event predates
  // this renderer (reload, late subscription).
  useEffect(() => {
    void refresh()
  }, [refresh])

  if (trips.length === 0) return null
  return (
    <div data-testid="breaker-notices">
      {trips.map((trip) => (
        <div
          key={trip.threadId}
          data-testid="breaker-notice"
          style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${colors.border.subtle}`,
            background: colors.callout.warning.bg,
            display: 'flex',
            flexDirection: 'column',
            gap: 5
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              fontFamily: typography.fontFamily.mono,
              fontSize: 11
            }}
          >
            <span
              data-testid="breaker-notice-badge"
              style={{
                padding: '1px 6px',
                border: `1px solid ${colors.claude.warning}`,
                borderRadius: borderRadius.inline,
                color: colors.claude.warning,
                background: `color-mix(in srgb, ${colors.claude.warning} 8%, transparent)`,
                fontSize: 10,
                letterSpacing: '0.02em'
              }}
            >
              breaker {trip.action === 'killed' ? 'tripped' : 'notice'}
            </span>
            <span style={{ color: colors.text.primary }}>{trip.agentId}</span>
            <span style={{ color: colors.text.muted }}>{trip.threadId}</span>
          </div>
          <div
            style={{
              color: colors.text.secondary,
              fontFamily: typography.fontFamily.body,
              fontSize: 11.5,
              lineHeight: 1.5
            }}
          >
            {REASON_LABEL[trip.reason]} — {trip.detail}.{' '}
            {trip.action === 'killed'
              ? 'The agent PTY was stopped as containment. Its writes are already on disk and stay in this queue for review; sending a new message starts a fresh, attributed session.'
              : trip.reason === 'head-moved'
                ? 'A HEAD move alone is indistinguishable from your own git activity, so nothing was stopped automatically — review the queue and use the Kill control if this was the agent.'
                : 'Attribution was ambiguous (concurrent turns), so nothing was stopped automatically — review the queue and use the Kill control on the responsible thread.'}
          </div>
        </div>
      ))}
    </div>
  )
}
