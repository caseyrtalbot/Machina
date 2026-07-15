/**
 * Approvals notifier (workstation Phase 3 step 2, contracts §4 v1.3.1).
 *
 * OS notifications + dock badge for the approval surface, driven from the
 * queue's single mutation choke point (the enriched notify delta) plus the
 * three non-queue safety signals (breaker trips, watcher-down transitions,
 * mirror-persist failures). All copy obeys the ApprovalsTray.tsx header
 * honesty rule: writes are already on disk when they reach the queue —
 * "queued for review", never "blocked"/"prevented".
 *
 * Attention policy (recorded product decision — do not re-litigate):
 *
 * | class                  | when it notifies                              |
 * | ---------------------- | --------------------------------------------- |
 * | interactive-queue      | only while the window is unfocused            |
 * | loop-queue (reserved)  | ALWAYS (signal arrives with the step-6 loop    |
 * |                        | scheduler via ApprovalsAddedItem.loopContext)  |
 * | breaker-trip           | ALWAYS                                        |
 * | watcher-down           | ALWAYS (down transitions only)                |
 * | spend-disarm (reserved)| ALWAYS (maxSpendUsd/disarm arrive step 6–7)   |
 * | persistence-degraded   | ALWAYS, once per failure streak               |
 *
 * The dock badge always reflects the pending count, regardless of focus.
 *
 * Dependencies are constructor-injected so the policy runs — and tests run —
 * without Electron; getApprovalsNotifier() wires the real Notification /
 * dock / window deps.
 */
import { Notification, app } from 'electron'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import type { ApprovalsAddedItem } from '@shared/ipc-channels'
import { typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'

export type AttentionClass =
  | 'interactive-queue'
  | 'loop-queue'
  | 'breaker-trip'
  | 'watcher-down'
  | 'spend-disarm'
  | 'persistence-degraded'

export type AttentionRule = 'unfocused-only' | 'always'

/** The recorded policy table (contracts §4 v1.3.1). */
export const ATTENTION_POLICY: Readonly<Record<AttentionClass, AttentionRule>> = {
  'interactive-queue': 'unfocused-only',
  'loop-queue': 'always',
  'breaker-trip': 'always',
  'watcher-down': 'always',
  'spend-disarm': 'always',
  'persistence-degraded': 'always'
}

/** Queue-item classification; the loop-context signal arrives at step 6. */
export function classifyQueueItem(item: ApprovalsAddedItem): AttentionClass {
  return item.loopContext === true ? 'loop-queue' : 'interactive-queue'
}

export interface NotifierNotification {
  readonly title: string
  readonly body: string
}

export interface ApprovalsNotifierDeps {
  /** Electron Notification.isSupported() in production. */
  readonly isSupported: () => boolean
  /** Show one OS notification; onClick fires when the user clicks it. */
  readonly show: (notification: NotifierNotification, onClick: () => void) => void
  readonly isWindowFocused: () => boolean
  /** Focus the window and land in the tray (approvals:open-tray). */
  readonly focusWindow: () => void
  /** Dock badge text; count 0 clears it. */
  readonly setBadge: (count: number) => void
}

/** Last path segment for compact root labels (the tray's rootBasename). */
function rootBasename(root: string): string {
  const segments = root.split('/').filter((s) => s.length > 0)
  return segments[segments.length - 1] ?? root
}

function queueItemNotification(item: ApprovalsAddedItem): NotifierNotification {
  const where = item.capturedRoot === null ? '' : ` in ${rootBasename(item.capturedRoot)}`
  if (item.kind === 'gate-confirm') {
    return {
      title: 'Agent write awaiting confirmation',
      body: `${item.agentId}${where} — review it in the approvals tray`
    }
  }
  const files = item.pathCount === 1 ? '1 file' : `${item.pathCount} files`
  return {
    title: 'Agent changes queued for review',
    body: `${item.agentId} wrote ${files}${where} — already on disk, awaiting your review`
  }
}

export class ApprovalsNotifier {
  /**
   * Persist-failure streak guard: the disk mirror persists on EVERY queue
   * mutation, so a broken disk would otherwise fire once per mutation. One
   * notification per failure streak; a successful persist re-arms it.
   */
  private persistFailureNotified = false

  constructor(private readonly deps: ApprovalsNotifierDeps) {}

  /**
   * Queue mutation tap (beside the renderer broadcast, never through the
   * persist wiring). Badge always tracks the pending count; each genuinely-
   * new item notifies per its attention class.
   */
  onQueueChanged(pending: number, added: readonly ApprovalsAddedItem[]): void {
    this.deps.setBadge(pending)
    for (const item of added) {
      this.notify(classifyQueueItem(item), queueItemNotification(item))
    }
  }

  /** Circuit-breaker trip: always notifies (safety class). */
  notifyBreakerTripped(event: BreakerTripEvent): void {
    const action = event.action === 'killed' ? 'session closed' : 'review needed'
    this.notify('breaker-trip', {
      title: 'Agent circuit breaker tripped',
      body: `${event.agentId}: ${event.detail} (${action})`
    })
  }

  /**
   * Watcher-health down transition: always notifies — "gate went down" is
   * exactly when the tray dot goes unseen. Callers fire this on the
   * TRANSITION only (ipc/git.ts markApprovalsWatcherDown), not on every
   * failed retry inside a down window.
   */
  notifyWatcherDown(reason: string): void {
    this.notify('watcher-down', {
      title: 'Write containment is down',
      body: `Agent writes are not being captured for review: ${reason}`
    })
  }

  /**
   * Disk-mirror persist failure (the step-1 recorded residual: previously
   * swallowed). Durability is degraded — queued items may not survive a
   * restart — so it always notifies, once per failure streak.
   */
  notePersistFailure(): void {
    if (this.persistFailureNotified) return
    this.persistFailureNotified = true
    this.notify('persistence-degraded', {
      title: 'Approval queue mirror failed to save',
      body: 'Queued items may not survive a restart until a later save succeeds'
    })
  }

  /** A successful persist closes the failure streak and re-arms the notice. */
  notePersistOk(): void {
    this.persistFailureNotified = false
  }

  private notify(cls: AttentionClass, notification: NotifierNotification): void {
    if (!this.deps.isSupported()) return
    if (ATTENTION_POLICY[cls] === 'unfocused-only' && this.deps.isWindowFocused()) return
    this.deps.show(notification, () => this.deps.focusWindow())
  }
}

// ── Singleton wiring (real Electron deps; tests construct the class) ───────

let singleton: ApprovalsNotifier | null = null

export function getApprovalsNotifier(): ApprovalsNotifier {
  if (singleton === null) {
    singleton = new ApprovalsNotifier({
      // Best-effort surface: a notification failure must never fail the
      // queue mutation or health transition that triggered it — hence the
      // access-safe probe (partial electron test mocks throw on missing
      // exports; Electron-free imports leave the binding undefined) and the
      // try/catch on the platform calls.
      isSupported: () => {
        try {
          return Notification !== undefined && Notification.isSupported()
        } catch {
          return false
        }
      },
      show: (notification, onClick) => {
        try {
          const n = new Notification({ title: notification.title, body: notification.body })
          n.on('click', onClick)
          n.show()
        } catch {
          // Display failure — the tray badge remains the durable surface.
        }
      },
      isWindowFocused: () => getMainWindow()?.isFocused() ?? false,
      focusWindow: () => {
        const window = getMainWindow()
        if (window === null) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        // Land IN the tray, not just on the app (Casey gate: click → tray).
        typedSend(window, 'approvals:open-tray', {})
      },
      setBadge: (count) => {
        try {
          app.dock?.setBadge(count > 0 ? String(count) : '')
        } catch {
          // Non-macOS or headless test — the in-app badge still renders.
        }
      }
    })
  }
  return singleton
}
