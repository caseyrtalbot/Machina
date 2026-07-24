/**
 * Approvals tray (workstation step 3, contracts §4).
 *
 * Titlebar badge + popover for the agent approval queue. The copy is
 * deliberately honest about post-persistence containment: writes are ALREADY
 * on disk when they appear here — Approve blesses them into history, Reject
 * reverts via git. Never phrase the queue as write-blocking.
 */
import { useCallback, useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import type { PendingChange } from '@shared/git-types'
import { isForeignRoot, isWatcherUnhealthy, useApprovalsStore } from '../../store/approvals-store'
import { useVaultStore } from '../../store/vault-store'
import { AgentBreakerNotices } from './agent-breaker-notice'
import { flagChips } from './approval-flags'
import { REVERT_AGENT_EVENT, RevertAgentSection } from './RevertAgentSection'
import { colors } from '../../design/tokens'
import { Overlay } from '../../components/overlay/Overlay'

const PATHS_SHOWN_MAX = 6

export function ApprovalsTray() {
  const pending = useApprovalsStore((s) => s.pending)
  const items = useApprovalsStore((s) => s.items)
  const activeRoot = useApprovalsStore((s) => s.activeRoot)
  const notice = useApprovalsStore((s) => s.notice)
  const resolving = useApprovalsStore((s) => s.resolving)
  const refresh = useApprovalsStore((s) => s.refresh)
  const resolve = useApprovalsStore((s) => s.resolve)
  const clearNotice = useApprovalsStore((s) => s.clearNotice)
  const watcherHealth = useApprovalsStore((s) => s.watcherHealth)
  const retrying = useApprovalsStore((s) => s.retrying)
  const retryWatcher = useApprovalsStore((s) => s.retryWatcher)
  const refreshWatcherHealth = useApprovalsStore((s) => s.refreshWatcherHealth)

  const [open, setOpen] = useState(false)
  // Palette-routed revert request (step 5): arms RevertAgentSection's confirm.
  const [revertRequest, setRevertRequest] = useState<string | null>(null)
  const unhealthy = isWatcherUnhealthy(watcherHealth)

  // Initial badge count + health snapshot; afterwards approvals:changed and
  // approvals:watcher-health keep the store live. vaultPath is a dep so a
  // workspace switch re-fetches activeRoot (v1.3.0 multi-root queue: items
  // survive the switch, but which of them read as foreign just flipped).
  const vaultPath = useVaultStore((s) => s.vaultPath)
  useEffect(() => {
    void refresh()
    void refreshWatcherHealth()
  }, [refresh, refreshWatcherHealth, vaultPath])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  // Palette "Revert harness: <slug>" entries route here (step 5): the tray is
  // the one confirm surface for git-consequences actions (OQ5) — the palette
  // never reverts directly.
  useEffect(() => {
    const onRevertRequest = (e: Event) => {
      const agentId = (e as CustomEvent<string>).detail
      if (typeof agentId !== 'string' || agentId.length === 0) return
      setRevertRequest(agentId)
      setOpen(true)
    }
    window.addEventListener(REVERT_AGENT_EVENT, onRevertRequest)
    return () => window.removeEventListener(REVERT_AGENT_EVENT, onRevertRequest)
  }, [])

  // OS-notification click-to-focus lands IN the tray (Phase 3 step 2,
  // contracts §4 v1.3.1): main focuses the window then fires
  // approvals:open-tray. Guarded like the store's module-level subscriptions
  // so component tests without a preload bridge stay inert.
  useEffect(() => {
    const subscribe = window.api?.notifications?.onOpenTray
    if (subscribe === undefined) return
    return subscribe(() => setOpen(true))
  }, [])

  // A stale request must not re-arm the confirm on the next manual open —
  // cleared render-side when the popover closes (CommandPalette's prevOpen
  // pattern; a setState-in-effect here is a cascading-render lint error).
  if (!open && revertRequest !== null) setRevertRequest(null)

  const toggle = useCallback(() => {
    setOpen((v) => !v)
    clearNotice()
  }, [clearNotice])

  // Foreign-root switch affordance (contracts §4 v1.3.0, OQ-A option (a)):
  // never resolve across roots — route through the ONE full-switch path
  // (te:open-vault → orchestrateLoad → workspace.open(); the FilesDockAdapter
  // precedent) so PathGuard/MCP/index/health all rebind to the new root.
  const switchToRoot = useCallback((root: string) => {
    window.dispatchEvent(new CustomEvent('te:open-vault', { detail: root }))
  }, [])

  return (
    <div className="te-tray-anchor">
      <button
        type="button"
        data-testid="approvals-tray-button"
        onClick={toggle}
        // The popover's outside-mousedown listener (Overlay) only wraps the
        // popover panel, not this trigger — without this guard a click here
        // while open would fire Overlay's close AND this button's toggle,
        // net effect a reopen instead of a close. Stopping propagation keeps
        // the trigger the sole source of truth for its own open state.
        onMouseDown={(event) => event.stopPropagation()}
        className="titlebar-toggle te-tray-trigger"
        data-open={open ? 'true' : undefined}
        aria-label={`Agent approvals: ${pending} pending${
          unhealthy && watcherHealth !== null ? `; write containment ${watcherHealth.state}` : ''
        }`}
        aria-expanded={open}
        title="Agent approvals"
      >
        <Inbox size={15} strokeWidth={1.75} aria-hidden />
        {pending > 0 && (
          <span data-testid="approvals-tray-badge" className="te-tray-badge">
            {pending > 99 ? '99+' : pending}
          </span>
        )}
        {unhealthy && (
          <span
            data-testid="approvals-watcher-warning"
            aria-hidden
            className="te-tray-watcher-dot"
          />
        )}
      </button>

      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        variant="popover"
        zLayer="dockPopover"
        className="te-tray-popover"
      >
        <div
          data-testid="approvals-popover"
          role="dialog"
          aria-label="Agent approvals"
          className="te-tray-popover-inner"
        >
          <div className="te-tray-header">Agent approvals · {pending} pending</div>

          {unhealthy && watcherHealth !== null && (
            <div data-testid="approvals-watcher-banner" className="te-tray-watcher-banner">
              <div className="te-tray-watcher-banner-text">
                Write containment is not watching. Agent writes since{' '}
                {new Date(watcherHealth.since).toLocaleTimeString()} are not being captured for
                review.
              </div>
              <button
                type="button"
                data-testid="approvals-watcher-retry"
                disabled={retrying}
                title="Restart the agent write watcher"
                onClick={() => void retryWatcher()}
                className="te-tray-action"
                data-tone="warn"
              >
                Retry
              </button>
            </div>
          )}

          {/* Breaker-tripped notice rows (workstation Phase 2 step 6):
              mount-only insertion — all UI/state lives in
              agent-breaker-notice.tsx; renders nothing with zero trips. */}
          <AgentBreakerNotices />

          {notice !== null && (
            <div data-testid="approvals-notice" className="te-tray-notice">
              {notice}
            </div>
          )}

          <div className="te-tray-scroll">
            {items.length === 0 ? (
              <div data-testid="approvals-empty" className="te-tray-empty">
                No pending agent changes.
              </div>
            ) : (
              items.map((item) => (
                <ApprovalItem
                  key={item.id}
                  item={item}
                  foreign={isForeignRoot(item, activeRoot)}
                  busy={resolving !== null}
                  onResolve={(approve) => void resolve(item.id, approve)}
                  onSwitchRoot={switchToRoot}
                />
              ))
            )}
          </div>

          <RevertAgentSection requestedAgentId={revertRequest} />

          <div className="te-tray-footer">
            These changes are already on disk. Approve records them as a commit; Reject reverts
            files via git. Only writes inside the workspace root are tracked.
            {items.some((item) => item.kind === 'gate-confirm') && (
              <>
                {' '}
                Write confirms are the exception: the write waits for your decision — Approve allows
                it, Reject denies it.
              </>
            )}
          </div>
        </div>
      </Overlay>
    </div>
  )
}

/** Last path segment for compact root labels; full path stays in the title. */
function rootBasename(root: string): string {
  const segments = root.split('/').filter((s) => s.length > 0)
  return segments[segments.length - 1] ?? root
}

interface ApprovalItemProps {
  readonly item: PendingChange
  /** capturedRoot ≠ active root: resolution would refuse ('workspace-changed'). */
  readonly foreign: boolean
  readonly busy: boolean
  readonly onResolve: (approve: boolean) => void
  readonly onSwitchRoot: (root: string) => void
}

function ApprovalItem({ item, foreign, busy, onResolve, onSwitchRoot }: ApprovalItemProps) {
  const chips = flagChips(item)
  // Gate-confirms always accept a deny; cli-changes need git to revert.
  const rejectDisabled = busy || (item.kind === 'cli-change' && !item.revertible)
  const shownPaths = item.paths.slice(0, PATHS_SHOWN_MAX)
  const hiddenCount = item.paths.length - shownPaths.length
  const capturedRoot = item.capturedRoot ?? null

  return (
    <div data-testid="approval-item" className="te-tray-item">
      <div className="te-tray-item-head">
        <span className="te-tray-id">{item.agentId}</span>
        <span className="te-tray-meta">{item.threadId}</span>
        {item.kind === 'gate-confirm' && (
          // Converged surfaces (v1.3.1): MCP and native-agent write confirms
          // ride this row — never a modal. Copy honesty: the write is
          // awaiting confirmation, nothing is phrased as blocked.
          <span data-testid="approval-gate-confirm" className="te-tray-meta">
            write confirm
          </span>
        )}
        {foreign && capturedRoot !== null && (
          <span
            data-testid="approval-root-label"
            title={capturedRoot}
            className="te-tray-root-label"
          >
            {rootBasename(capturedRoot)}
          </span>
        )}
      </div>

      {item.description !== undefined && <div className="te-tray-desc">{item.description}</div>}

      {chips.length > 0 && (
        <div className="te-tray-chips">
          {chips.map((chip) => (
            <span
              key={chip.label}
              data-testid={`approval-flag-${chip.key}`}
              className="te-tray-chip"
              // chip.color is a runtime flag-identity color (approval-flags.ts).
              style={{
                borderColor: chip.color,
                color: chip.color,
                background: `color-mix(in srgb, ${chip.color} 8%, transparent)`
              }}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {item.flags.headMoved && (
        <div data-testid="approval-headmoved-banner" className="te-tray-headmoved">
          Git history moved during this turn — the agent ran git itself. Review the diff against the
          actual repo state before deciding.
        </div>
      )}

      <div className="te-tray-paths">
        {shownPaths.map((p) => (
          <span key={p} className="te-tray-path">
            {p}
          </span>
        ))}
        {hiddenCount > 0 && <span className="te-tray-meta">+{hiddenCount} more</span>}
      </div>

      {item.diff.length > 0 && (
        <pre data-testid="approval-diff" className="te-tray-diff">
          {item.diff.split('\n').map((line, i) => (
            // diffLineColor is a per-line semantic color (added/removed/meta).
            <div key={i} style={{ color: diffLineColor(line) }}>
              {line.length === 0 ? ' ' : line}
            </div>
          ))}
        </pre>
      )}

      {/* Foreign-root items (v1.3.0, OQ-A option (a)): resolution is bound to
          the item's capturedRoot — main refuses cross-root with
          'workspace-changed' — so the tray offers the switch, never a resolve
          that would fail. Copy stays honest: writes are on disk either way. */}
      {foreign ? (
        <div data-testid="approval-foreign-root" className="te-tray-foreign">
          <span className="te-tray-foreign-text">
            {capturedRoot === null
              ? 'Captured with no workspace open — it cannot be resolved from here.'
              : 'Captured in a different workspace.'}
          </span>
          {capturedRoot !== null && (
            <button
              type="button"
              data-testid="approval-switch-root"
              title={`Open ${capturedRoot} to resolve this change`}
              onClick={() => onSwitchRoot(capturedRoot)}
              className="te-tray-action te-tray-switch"
              data-tone="accent"
            >
              Switch to {rootBasename(capturedRoot)} to resolve
            </button>
          )}
        </div>
      ) : (
        <div className="te-tray-actions">
          <button
            type="button"
            data-testid="approval-reject"
            disabled={rejectDisabled}
            title={
              item.kind === 'gate-confirm'
                ? 'Deny this write request'
                : !item.revertible
                  ? 'Not a git repository — nothing to revert from'
                  : 'Revert these files via git'
            }
            onClick={() => onResolve(false)}
            className="te-tray-action"
            data-tone="danger"
          >
            Reject
          </button>
          <button
            type="button"
            data-testid="approval-approve"
            disabled={busy}
            title={
              item.kind === 'gate-confirm'
                ? 'Allow this write to proceed'
                : item.revertible
                  ? 'Record these changes as a commit'
                  : 'Acknowledge — non-repo workspace, no commit is possible'
            }
            onClick={() => onResolve(true)}
            className="te-tray-action"
            data-tone="ready"
          >
            Approve
          </button>
        </div>
      )}
    </div>
  )
}

function diffLineColor(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return colors.diff.added
  if (line.startsWith('-') && !line.startsWith('---')) return colors.diff.removed
  if (line.startsWith('@@')) return colors.text.muted
  return colors.text.secondary
}
