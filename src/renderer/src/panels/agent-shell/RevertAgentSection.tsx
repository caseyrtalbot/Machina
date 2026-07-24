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
    <div data-testid="revert-agent-section" className="te-revert-section">
      <button
        type="button"
        data-testid="revert-agent-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="te-revert-toggle"
      >
        {expanded ? (
          <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
        )}
        Revert agent commits
      </button>

      {expanded && (
        <div className="te-revert-list">
          {notice !== null && (
            <div data-testid="revert-agent-notice" className="te-revert-notice">
              {notice}
            </div>
          )}

          {list.kind === 'error' && (
            <div data-testid="revert-agent-error" className="te-revert-empty">
              {list.reason === 'not-a-git-repo'
                ? 'Not a git repository — nothing to revert from.'
                : list.reason === 'no-workspace'
                  ? 'No workspace open.'
                  : list.reason === 'git-failed'
                    ? 'Agent commits unavailable — git log failed. This is an error, not "nothing to revert": agent commits may still exist. Retry, or check git directly.'
                    : `Agent commits unavailable: ${list.reason}`}
            </div>
          )}

          {list.kind === 'loaded' && list.agents.length === 0 && (
            <div data-testid="revert-agent-empty" className="te-revert-empty">
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
    <div data-testid={`revert-agent-row-${agent.agentId}`} className="te-revert-row">
      <div className="te-revert-row-head">
        <span className="te-revert-row-id">
          <span className="te-tray-id">{agent.agentId}</span>
          <span className="te-tray-meta">
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
            className="te-tray-action"
            data-tone="danger"
          >
            Revert…
          </button>
        )}
      </div>

      <div className="te-revert-subject">
        {agent.lastSubject}
        <span className="te-tray-meta"> · {formatDate(agent.lastDate)}</span>
      </div>

      {confirming && (
        <div data-testid="revert-agent-confirm" className="te-revert-confirm">
          <div className="te-revert-confirm-text">
            Revert {count} {commits} by {agent.agentId}? This creates new commits that undo them —
            history is not deleted, and this is not protection: writes the agent makes after this
            are not blocked.
          </div>
          <div className="te-tray-actions">
            <button
              type="button"
              data-testid="revert-agent-cancel"
              disabled={busy}
              onClick={onCancel}
              className="te-tray-action"
              data-tone="neutral"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="revert-agent-confirm-button"
              disabled={busy}
              title="Create commits reverting this agent's commits"
              onClick={onConfirm}
              className="te-tray-action"
              data-tone="danger"
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
