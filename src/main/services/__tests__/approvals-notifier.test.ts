// @vitest-environment node
/**
 * ApprovalsNotifier attention policy (Phase 3 step 2, contracts §4 v1.3.1).
 *
 * The policy table is a recorded product decision: interactive-session queue
 * items notify only while the window is unfocused; loop-context items (the
 * reserved step-6 class), breaker trips, watcher-down transitions, and
 * persistence-degraded events ALWAYS notify; the dock badge always reflects
 * the pending count. Copy lint: no notification string may phrase the queue
 * as write-blocking (the ApprovalsTray.tsx header rule, extended to OS
 * surfaces).
 */
import { describe, it, expect, vi } from 'vitest'

// The module imports electron for its production singleton; the class under
// test is constructed with fake deps and never touches it.
vi.mock('electron', () => ({ Notification: undefined, app: {} }))

import {
  ApprovalsNotifier,
  ATTENTION_POLICY,
  classifyQueueItem,
  type NotifierNotification
} from '../approvals-notifier'
import type { ApprovalsAddedItem } from '@shared/ipc-channels'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'

interface Harness {
  readonly notifier: ApprovalsNotifier
  readonly shown: NotifierNotification[]
  readonly clicks: Array<() => void>
  readonly badges: number[]
  readonly focusWindow: ReturnType<typeof vi.fn>
  setFocused(next: boolean): void
}

function makeHarness(opts: { focused?: boolean; supported?: boolean } = {}): Harness {
  const shown: NotifierNotification[] = []
  const clicks: Array<() => void> = []
  const badges: number[] = []
  const focusWindow = vi.fn()
  let focused = opts.focused ?? false
  const notifier = new ApprovalsNotifier({
    isSupported: () => opts.supported ?? true,
    show: (notification, onClick) => {
      shown.push(notification)
      clicks.push(onClick)
    },
    isWindowFocused: () => focused,
    focusWindow,
    setBadge: (count) => badges.push(count)
  })
  return {
    notifier,
    shown,
    clicks,
    badges,
    focusWindow,
    setFocused: (next) => {
      focused = next
    }
  }
}

const cliItem: ApprovalsAddedItem = {
  id: 'pc_t1-run',
  kind: 'cli-change',
  agentId: 'test-fixer',
  threadId: 'th-1',
  capturedRoot: '/Users/x/vault',
  pathCount: 2
}

const gateItem: ApprovalsAddedItem = {
  id: 'gc_1',
  kind: 'gate-confirm',
  agentId: 'vault.write_file',
  threadId: 'mcp-gate',
  capturedRoot: '/Users/x/vault',
  pathCount: 1
}

const trip: BreakerTripEvent = {
  threadId: 'th-1',
  agentId: 'test-fixer',
  reason: 'velocity',
  action: 'killed',
  detail: '3 consecutive high-velocity batches',
  at: '2026-07-14T00:00:00.000Z'
}

describe('attention policy table (recorded, do not re-litigate)', () => {
  it('pins the recorded rules per class', () => {
    expect(ATTENTION_POLICY).toEqual({
      'interactive-queue': 'unfocused-only',
      'loop-queue': 'always',
      'breaker-trip': 'always',
      'watcher-down': 'always',
      'spend-disarm': 'always',
      'persistence-degraded': 'always'
    })
  })

  it('classifies queue items: interactive by default, loop-queue when flagged (step-6 seam)', () => {
    expect(classifyQueueItem(cliItem)).toBe('interactive-queue')
    expect(classifyQueueItem({ ...cliItem, loopContext: true })).toBe('loop-queue')
  })
})

describe('queue-item notifications', () => {
  it('interactive items notify while the window is unfocused', () => {
    const h = makeHarness({ focused: false })
    h.notifier.onQueueChanged(1, [cliItem])
    expect(h.shown).toHaveLength(1)
    expect(h.shown[0].title).toBe('Agent changes queued for review')
  })

  it('interactive items are suppressed while the window is focused', () => {
    const h = makeHarness({ focused: true })
    h.notifier.onQueueChanged(1, [cliItem])
    expect(h.shown).toEqual([])
  })

  it('loop-context items ALWAYS notify, even focused (reserved step-6 class)', () => {
    const h = makeHarness({ focused: true })
    h.notifier.onQueueChanged(1, [{ ...cliItem, loopContext: true }])
    expect(h.shown).toHaveLength(1)
  })

  it('an empty delta (a resolve) never notifies', () => {
    const h = makeHarness({ focused: false })
    h.notifier.onQueueChanged(0, [])
    expect(h.shown).toEqual([])
  })

  it('the dock badge always reflects the pending count, focused or not', () => {
    const h = makeHarness({ focused: true })
    h.notifier.onQueueChanged(3, [])
    h.notifier.onQueueChanged(0, [])
    expect(h.badges).toEqual([3, 0])
  })

  it('clicking a notification focuses the window (click lands in the tray)', () => {
    const h = makeHarness({ focused: false })
    h.notifier.onQueueChanged(1, [cliItem])
    h.clicks[0]()
    expect(h.focusWindow).toHaveBeenCalledTimes(1)
  })

  it('unsupported platform: badge still tracks, nothing is shown', () => {
    const h = makeHarness({ focused: false, supported: false })
    h.notifier.onQueueChanged(1, [cliItem])
    expect(h.badges).toEqual([1])
    expect(h.shown).toEqual([])
  })
})

describe('always-notify safety classes', () => {
  it('breaker trips notify even while focused', () => {
    const h = makeHarness({ focused: true })
    h.notifier.notifyBreakerTripped(trip)
    expect(h.shown).toHaveLength(1)
    expect(h.shown[0].title).toBe('Agent circuit breaker tripped')
  })

  it('watcher-down transitions notify even while focused', () => {
    const h = makeHarness({ focused: true })
    h.notifier.notifyWatcherDown('chokidar error')
    expect(h.shown).toHaveLength(1)
    expect(h.shown[0].title).toBe('Write containment is down')
  })

  it('persist failures notify once per failure streak; a success re-arms', () => {
    const h = makeHarness({ focused: true })
    h.notifier.notePersistFailure()
    h.notifier.notePersistFailure()
    h.notifier.notePersistFailure()
    expect(h.shown).toHaveLength(1)

    h.notifier.notePersistOk()
    h.notifier.notePersistFailure()
    expect(h.shown).toHaveLength(2)
  })
})

describe('copy gate (tray header honesty rule, extended to OS surfaces)', () => {
  it('no notification string claims writes are blocked or prevented', () => {
    const h = makeHarness({ focused: false })
    h.notifier.onQueueChanged(2, [cliItem, gateItem])
    h.notifier.onQueueChanged(2, [{ ...cliItem, id: 'pc_x', capturedRoot: null, pathCount: 1 }])
    h.notifier.notifyBreakerTripped(trip)
    h.notifier.notifyBreakerTripped({ ...trip, action: 'notice' })
    h.notifier.notifyWatcherDown('ready timeout')
    h.notifier.notePersistFailure()

    expect(h.shown.length).toBeGreaterThanOrEqual(6)
    for (const { title, body } of h.shown) {
      expect(`${title} ${body}`).not.toMatch(/\bblock(ed|ing|s)?\b|\bprevent(ed|ing|s)?\b/i)
    }
  })
})
