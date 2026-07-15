/**
 * Approvals tray (workstation step 3, contracts §4).
 *
 * Titlebar badge + popover for the agent approval queue. The copy is
 * deliberately honest about post-persistence containment: writes are ALREADY
 * on disk when they appear here — Approve blesses them into history, Reject
 * reverts via git. Never phrase the queue as write-blocking.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox } from 'lucide-react'
import type { PendingChange } from '@shared/git-types'
import { isForeignRoot, isWatcherUnhealthy, useApprovalsStore } from '../../store/approvals-store'
import { useVaultStore } from '../../store/vault-store'
import { AgentBreakerNotices } from './agent-breaker-notice'
import { flagChips } from './approval-flags'
import { REVERT_AGENT_EVENT, RevertAgentSection } from './RevertAgentSection'
import { borderRadius, colors, floatingPanel, transitions, typography } from '../../design/tokens'

const PATHS_SHOWN_MAX = 6
const TRIGGER_BUTTON_SIZE = 26

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
  const [hovered, setHovered] = useState(false)
  // Palette-routed revert request (step 5): arms RevertAgentSection's confirm.
  const [revertRequest, setRevertRequest] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
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
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
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
    <div ref={popoverRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="approvals-tray-button"
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Agent approvals: ${pending} pending${
          unhealthy && watcherHealth !== null ? `; write containment ${watcherHealth.state}` : ''
        }`}
        aria-expanded={open}
        title="Agent approvals"
        style={{
          width: TRIGGER_BUTTON_SIZE,
          height: TRIGGER_BUTTON_SIZE,
          padding: 0,
          boxSizing: 'border-box',
          position: 'relative',
          borderRadius: borderRadius.inline,
          border: `1px solid ${
            open ? colors.accent.line : hovered ? colors.border.default : 'transparent'
          }`,
          background: open
            ? 'color-mix(in srgb, var(--color-accent-default) 10%, transparent)'
            : hovered
              ? 'var(--bg-tint-text)'
              : 'transparent',
          color: open
            ? colors.accent.default
            : hovered
              ? colors.text.primary
              : colors.text.secondary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: `background ${transitions.focusRing}, color ${transitions.focusRing}, border-color ${transitions.focusRing}`,
          // @ts-expect-error -- Electron-only CSS property
          WebkitAppRegion: 'no-drag'
        }}
      >
        <Inbox size={15} strokeWidth={1.75} aria-hidden />
        {pending > 0 && (
          <span
            data-testid="approvals-tray-badge"
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              boxSizing: 'border-box',
              borderRadius: borderRadius.inline,
              background: colors.accent.default,
              color: 'var(--color-bg-base)',
              fontFamily: typography.fontFamily.mono,
              fontSize: 9,
              lineHeight: '14px',
              textAlign: 'center'
            }}
          >
            {pending > 99 ? '99+' : pending}
          </span>
        )}
        {unhealthy && (
          <span
            data-testid="approvals-watcher-warning"
            aria-hidden
            style={{
              position: 'absolute',
              bottom: -3,
              right: -3,
              width: 8,
              height: 8,
              // Round exception: status dot (knife-edge geometry contract).
              borderRadius: '50%',
              background: colors.claude.warning,
              border: '2px solid var(--color-bg-base)',
              boxSizing: 'content-box'
            }}
          />
        )}
      </button>

      {open && (
        <div
          data-testid="approvals-popover"
          role="dialog"
          aria-label="Agent approvals"
          style={{
            position: 'fixed',
            top: 44,
            right: 10,
            width: 440,
            maxHeight: '72vh',
            display: 'flex',
            flexDirection: 'column',
            background: floatingPanel.glass.bg,
            backdropFilter: floatingPanel.glass.blur,
            WebkitBackdropFilter: floatingPanel.glass.blur,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: floatingPanel.borderRadius,
            boxShadow: floatingPanel.shadowCompact,
            zIndex: 1200,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${colors.border.subtle}`,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              color: colors.text.muted
            }}
          >
            Agent approvals · {pending} pending
          </div>

          {unhealthy && watcherHealth !== null && (
            <div
              data-testid="approvals-watcher-banner"
              style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${colors.border.subtle}`,
                background: colors.callout.warning.bg,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10
              }}
            >
              <div
                style={{
                  flex: 1,
                  color: colors.text.primary,
                  fontFamily: typography.fontFamily.body,
                  fontSize: 12,
                  lineHeight: 1.5
                }}
              >
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
                style={actionButtonStyle(colors.claude.warning, retrying)}
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
            <div
              data-testid="approvals-notice"
              style={{
                padding: '8px 14px',
                borderBottom: `1px solid ${colors.border.subtle}`,
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

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {items.length === 0 ? (
              <div
                data-testid="approvals-empty"
                style={{
                  padding: '18px 14px',
                  color: colors.text.muted,
                  fontFamily: typography.fontFamily.body,
                  fontSize: 12.5
                }}
              >
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

          <div
            style={{
              padding: '9px 14px',
              borderTop: `1px solid ${colors.border.subtle}`,
              color: colors.text.muted,
              fontFamily: typography.fontFamily.body,
              fontSize: 11.5,
              lineHeight: 1.55
            }}
          >
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
      )}
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
    <div
      data-testid="approval-item"
      style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${colors.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          fontFamily: typography.fontFamily.mono,
          fontSize: 11.5
        }}
      >
        <span style={{ color: colors.text.primary }}>{item.agentId}</span>
        <span style={{ color: colors.text.muted }}>{item.threadId}</span>
        {item.kind === 'gate-confirm' && (
          // Converged surfaces (v1.3.1): MCP and native-agent write confirms
          // ride this row — never a modal. Copy honesty: the write is
          // awaiting confirmation, nothing is phrased as blocked.
          <span data-testid="approval-gate-confirm" style={{ color: colors.text.muted }}>
            write confirm
          </span>
        )}
        {foreign && capturedRoot !== null && (
          <span
            data-testid="approval-root-label"
            title={capturedRoot}
            style={{
              marginLeft: 'auto',
              padding: '1px 6px',
              border: `1px solid ${colors.border.default}`,
              borderRadius: borderRadius.inline,
              color: colors.text.secondary,
              fontSize: 10,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap'
            }}
          >
            {rootBasename(capturedRoot)}
          </span>
        )}
      </div>

      {item.description !== undefined && (
        <div
          style={{
            color: colors.text.secondary,
            fontFamily: typography.fontFamily.body,
            fontSize: 12,
            lineHeight: 1.5
          }}
        >
          {item.description}
        </div>
      )}

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map((chip) => (
            <span
              key={chip.label}
              data-testid={`approval-flag-${chip.key}`}
              style={{
                padding: '2px 7px',
                border: `1px solid ${chip.color}`,
                borderRadius: borderRadius.inline,
                color: chip.color,
                background: `color-mix(in srgb, ${chip.color} 8%, transparent)`,
                fontFamily: typography.fontFamily.mono,
                fontSize: 10,
                letterSpacing: '0.02em'
              }}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {item.flags.headMoved && (
        <div
          data-testid="approval-headmoved-banner"
          style={{
            padding: '6px 9px',
            border: `1px solid ${colors.claude.error}`,
            borderRadius: borderRadius.inline,
            background: colors.callout.danger.bg,
            color: colors.text.primary,
            fontFamily: typography.fontFamily.body,
            fontSize: 11.5,
            lineHeight: 1.5
          }}
        >
          Git history moved during this turn — the agent ran git itself. Review the diff against the
          actual repo state before deciding.
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          fontFamily: typography.fontFamily.mono,
          fontSize: 11,
          color: colors.text.secondary
        }}
      >
        {shownPaths.map((p) => (
          <span key={p} style={{ wordBreak: 'break-all' }}>
            {p}
          </span>
        ))}
        {hiddenCount > 0 && <span style={{ color: colors.text.muted }}>+{hiddenCount} more</span>}
      </div>

      {item.diff.length > 0 && (
        <pre
          data-testid="approval-diff"
          style={{
            margin: 0,
            padding: '8px 10px',
            maxHeight: 180,
            overflow: 'auto',
            background: 'var(--color-bg-base)',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: borderRadius.inline,
            fontFamily: typography.fontFamily.mono,
            fontSize: 10.5,
            lineHeight: 1.5
          }}
        >
          {item.diff.split('\n').map((line, i) => (
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
        <div
          data-testid="approval-foreign-root"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between'
          }}
        >
          <span
            style={{
              color: colors.text.muted,
              fontFamily: typography.fontFamily.body,
              fontSize: 11.5,
              lineHeight: 1.5
            }}
          >
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
              style={{ ...actionButtonStyle(colors.accent.default, false), whiteSpace: 'nowrap' }}
            >
              Switch to {rootBasename(capturedRoot)} to resolve
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
            style={actionButtonStyle(colors.claude.error, rejectDisabled)}
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
            style={actionButtonStyle(colors.claude.ready, busy)}
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
