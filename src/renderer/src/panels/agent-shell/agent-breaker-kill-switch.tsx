/**
 * Manual kill switch + tripped-state chip for CLI thread headers
 * (workstation Phase 2 step 6, contracts §5 v1.2.6). Kill = the existing
 * hard-kill path surfaced: cli-thread:close kills the PTY and drops the turn
 * window with zero linger (writes still flushing become audited-unattributed
 * — the §4 trade). Distinct from the input bar's Stop (Ctrl+C), which
 * interrupts the invocation but leaves the shell alive.
 *
 * Liveness is sourced from the cli-session-store (the single sessionId
 * authority, step 4); the tripped state from the breaker store. Renders
 * nothing for threads with no live PTY and no trip.
 */
import { useEffect } from 'react'
import { useCliSessionStore } from '../../store/cli-session-store'
import { tripForThread, useAgentBreakerStore } from '../../store/agent-breaker-store'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'

export function AgentKillSwitch({ threadId }: { readonly threadId: string }) {
  const entry = useCliSessionStore((s) => s.byThread[threadId])
  const hydrate = useCliSessionStore((s) => s.hydrate)
  const trip = useAgentBreakerStore((s) => tripForThread(s.trips, threadId))
  const refreshBreaker = useAgentBreakerStore((s) => s.refresh)

  // Pull hydration for late subscribers (reload while the PTY survives);
  // breaker refresh covers trips that predate this renderer.
  useEffect(() => {
    void hydrate(threadId)
    void refreshBreaker()
  }, [threadId, hydrate, refreshBreaker])

  const live = entry?.live === true

  async function kill() {
    await window.api.cliThread.close(threadId)
    // The close is synchronous main-side; re-pull so the button drops
    // without waiting for a terminal-exit round trip.
    await hydrate(threadId)
  }

  if (!live && trip === null) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {trip !== null && (
        <span
          data-testid="breaker-tripped-chip"
          title={`Circuit breaker (${trip.reason}): ${trip.detail}. ${
            trip.action === 'killed'
              ? 'The PTY was stopped as containment; its writes stay in the approvals queue.'
              : 'Ambiguous attribution — nothing was stopped automatically.'
          }`}
          style={{
            padding: '2px 7px',
            border: `1px solid ${colors.claude.warning}`,
            borderRadius: borderRadius.inline,
            color: colors.claude.warning,
            background: `color-mix(in srgb, ${colors.claude.warning} 8%, transparent)`,
            fontFamily: typography.fontFamily.mono,
            fontSize: 10,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap'
          }}
        >
          breaker tripped
        </span>
      )}
      {live && (
        <button
          type="button"
          data-testid="agent-kill-switch"
          title="Kill this agent's shell now. Hard stop: the PTY dies immediately; writes already made stay on disk and in the approvals queue. The next message starts a fresh session."
          onClick={() => void kill()}
          style={{
            padding: '3px 9px',
            border: `1px solid ${colors.claude.error}`,
            borderRadius: borderRadius.inline,
            background: `color-mix(in srgb, ${colors.claude.error} 8%, transparent)`,
            color: colors.claude.error,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform,
            cursor: 'pointer',
            transition: `background ${transitions.fast}, color ${transitions.fast}`
          }}
        >
          kill
        </button>
      )}
    </span>
  )
}
