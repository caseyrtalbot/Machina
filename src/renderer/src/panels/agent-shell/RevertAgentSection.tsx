/**
 * Per-agent revert section in the approvals tray popover (workstation step 5,
 * contracts §2/§4/§6 v1.2.5).
 *
 * Read path is `git:list-agent-commits` — trailer enumeration, so ids from a
 * since-deleted harness (and adapter-identity fallbacks like `cli-claude`)
 * stay listed and revertable. Collapsed by default; the enumeration runs only
 * when the section is opened. Revert sits behind an inline confirm whose copy
 * follows the §4 containment framing: reverting CREATES new commits that undo
 * the agent's commits — it does not delete history and it is not protection.
 */
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentCommits } from '@shared/git-types'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'

/**
 * Palette "Revert harness: <slug>" entries dispatch this CustomEvent (detail =
 * agentId) so the tray — the one git-consequences confirm surface (OQ5) —
 * opens with the confirm armed. The palette never one-click reverts.
 */
export const REVERT_AGENT_EVENT = 'te:revert-agent'

type ListState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly agents: readonly AgentCommits[] }
  | { readonly kind: 'error'; readonly reason: string }

interface RevertAgentSectionProps {
  /** Non-null = external request (palette): expand and arm confirm for this id. */
  readonly requestedAgentId?: string | null
}

export function RevertAgentSection({ requestedAgentId = null }: RevertAgentSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [list, setList] = useState<ListState>({ kind: 'idle' })
  const [confirmFor, setConfirmFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setList({ kind: 'loading' })
    try {
      const res = await window.api.git.listAgentCommits()
      setList(
        res.ok ? { kind: 'loaded', agents: res.agents } : { kind: 'error', reason: res.reason }
      )
    } catch {
      setList({ kind: 'error', reason: 'unavailable' })
    }
  }, [])

  // Lazy: enumerate only when the section is opened (collapsed by default),
  // so rendering the tray popover costs no git log walk.
  useEffect(() => {
    if (expanded) void refresh()
  }, [expanded, refresh])

  // Palette route: expand and arm the confirm for the requested agent.
  useEffect(() => {
    if (requestedAgentId === null) return
    setExpanded(true)
    setConfirmFor(requestedAgentId)
  }, [requestedAgentId])

  const revert = useCallback(
    async (agentId: string, count: number) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await window.api.git.revertAgent(agentId)
        setNotice(
          res.ok
            ? `Reverted ${count} ${count === 1 ? 'commit' : 'commits'} by ${agentId} — recorded as a new revert commit.`
            : revertFailureCopy(agentId, res.reason)
        )
      } catch {
        setNotice(`Revert of ${agentId} failed: git unavailable. Nothing was committed.`)
      } finally {
        setBusy(false)
        setConfirmFor(null)
      }
      // Re-enumerate: reverted shas are excluded, so the group shrinks/disappears.
      await refresh()
    },
    [refresh]
  )

  return (
    <div
      data-testid="revert-agent-section"
      style={{ borderTop: `1px solid ${colors.border.subtle}` }}
    >
      <button
        type="button"
        data-testid="revert-agent-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '9px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted,
          transition: `color ${transitions.focusRing}`
        }}
      >
        {expanded ? (
          <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
        )}
        Revert agent commits
      </button>

      {expanded && (
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {notice !== null && (
            <div
              data-testid="revert-agent-notice"
              style={{
                padding: '8px 14px',
                borderTop: `1px solid ${colors.border.subtle}`,
                background: colors.callout.warning.bg,
                color: colors.text.primary,
                fontFamily: typography.fontFamily.body,
                fontSize: 12,
                lineHeight: 1.5
              }}
            >
              {notice}
            </div>
          )}

          {list.kind === 'error' && (
            <div data-testid="revert-agent-error" style={emptyRowStyle}>
              {list.reason === 'not-a-git-repo'
                ? 'Not a git repository — nothing to revert from.'
                : list.reason === 'no-workspace'
                  ? 'No workspace open.'
                  : `Agent commits unavailable: ${list.reason}`}
            </div>
          )}

          {list.kind === 'loaded' && list.agents.length === 0 && (
            <div data-testid="revert-agent-empty" style={emptyRowStyle}>
              No unreverted agent commits.
            </div>
          )}

          {list.kind === 'loaded' &&
            list.agents.map((agent) => (
              <AgentRow
                key={agent.agentId}
                agent={agent}
                busy={busy}
                confirming={confirmFor === agent.agentId}
                onArm={() => setConfirmFor(agent.agentId)}
                onCancel={() => setConfirmFor(null)}
                onConfirm={() => void revert(agent.agentId, agent.shas.length)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

interface AgentRowProps {
  readonly agent: AgentCommits
  readonly busy: boolean
  readonly confirming: boolean
  readonly onArm: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

function AgentRow({ agent, busy, confirming, onArm, onCancel, onConfirm }: AgentRowProps) {
  const count = agent.shas.length
  const commits = count === 1 ? 'commit' : 'commits'
  return (
    <div
      data-testid={`revert-agent-row-${agent.agentId}`}
      style={{
        padding: '10px 14px',
        borderTop: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 7
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            fontFamily: typography.fontFamily.mono,
            fontSize: 11.5
          }}
        >
          <span style={{ color: colors.text.primary }}>{agent.agentId}</span>
          <span style={{ color: colors.text.muted }}>
            {count} {commits}
          </span>
        </span>
        {!confirming && (
          <button
            type="button"
            data-testid={`revert-agent-arm-${agent.agentId}`}
            disabled={busy}
            title={`Revert ${agent.agentId}'s ${commits} (asks to confirm)`}
            onClick={onArm}
            style={actionButtonStyle(colors.claude.error, busy)}
          >
            Revert…
          </button>
        )}
      </div>

      <div
        style={{
          color: colors.text.secondary,
          fontFamily: typography.fontFamily.body,
          fontSize: 11.5,
          lineHeight: 1.5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {agent.lastSubject}
        <span style={{ color: colors.text.muted }}> · {formatDate(agent.lastDate)}</span>
      </div>

      {confirming && (
        <div
          data-testid="revert-agent-confirm"
          style={{
            padding: '8px 10px',
            border: `1px solid ${colors.claude.error}`,
            borderRadius: borderRadius.inline,
            background: colors.callout.danger.bg,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div
            style={{
              color: colors.text.primary,
              fontFamily: typography.fontFamily.body,
              fontSize: 11.5,
              lineHeight: 1.55
            }}
          >
            Revert {count} {commits} by {agent.agentId}? This creates new commits that undo them —
            history is not deleted, and this is not protection: writes the agent makes after this
            are not blocked.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              data-testid="revert-agent-cancel"
              disabled={busy}
              onClick={onCancel}
              style={actionButtonStyle(colors.text.secondary, busy)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="revert-agent-confirm-button"
              disabled={busy}
              title="Create commits reverting this agent's commits"
              onClick={onConfirm}
              style={actionButtonStyle(colors.claude.error, busy)}
            >
              Revert {count} {commits}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Honest, structured-reason failure copy — a failed revert changed nothing. */
function revertFailureCopy(agentId: string, reason: string): string {
  if (reason === 'revert-conflict') {
    return `Revert of ${agentId} conflicts with later commits — nothing was changed. Resolve in git directly.`
  }
  if (reason === 'no-commits-for-agent') {
    return `No unreverted commits remain for ${agentId}.`
  }
  return `Revert of ${agentId} failed: ${reason}. Nothing was committed.`
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString()
}

const emptyRowStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderTop: `1px solid ${colors.border.subtle}`,
  color: colors.text.muted,
  fontFamily: typography.fontFamily.body,
  fontSize: 12
}

function actionButtonStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    border: `1px solid ${disabled ? colors.border.subtle : color}`,
    borderRadius: borderRadius.inline,
    background: disabled ? 'transparent' : `color-mix(in srgb, ${color} 10%, transparent)`,
    color: disabled ? colors.text.disabled : color,
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    cursor: disabled ? 'default' : 'pointer',
    transition: `background ${transitions.focusRing}, color ${transitions.focusRing}`
  }
}
