/**
 * Thread-surface watcher-health signals (workstation step 2, contracts §4
 * v1.2.1): the tray is not where the user is when containment degrades, so
 * active CLI thread panels carry a compact chip while the watcher is
 * unhealthy, plus a one-time inline notice when a turn runs while state ∉
 * {watching}. Copy never claims writes are blocked — the gate is
 * post-persistence containment, and right now it is not even capturing.
 */
import { useState } from 'react'
import { isWatcherUnhealthy, useApprovalsStore } from '../../store/approvals-store'
import { useThreadStore } from '../../store/thread-store'

/** Compact header chip; renders nothing while healthy/stopped/unknown. */
export function WatcherHealthChip() {
  const health = useApprovalsStore((s) => s.watcherHealth)
  if (health === null || health.state === 'watching' || health.state === 'stopped') return null
  return (
    <span
      data-testid="thread-watcher-chip"
      title="Write containment is not watching. Agent writes are not being captured for review — retry from the approvals tray."
      className="te-watcher-chip"
    >
      containment {health.state}
    </span>
  )
}

/**
 * One-time inline notice: latches when a turn is in flight for this thread
 * while the watcher is unhealthy, and stays for the panel's lifetime (keyed
 * by threadId at the call site so switching threads resets it). Latching on
 * in-flight ∧ unhealthy also catches a watcher dying mid-turn — writes from
 * that point are equally uncaptured.
 */
export function WatcherHealthNotice({ threadId }: { readonly threadId: string }) {
  const health = useApprovalsStore((s) => s.watcherHealth)
  const inFlight = useThreadStore((s) => s.inFlightByThreadId[threadId] === true)
  const unhealthy = isWatcherUnhealthy(health)
  // Render-time latch (the React-endorsed "adjust state during render"
  // derivation: the triggering store update already re-rendered us, and once
  // tripped the value never resets for this mount).
  const [shown, setShown] = useState(false)
  if (inFlight && unhealthy && !shown) setShown(true)

  if (!shown) return null
  return (
    <div data-testid="thread-watcher-notice" className="te-watcher-notice">
      Write containment is not watching. File writes from this turn are not being captured for
      review. Retry from the approvals tray.
    </div>
  )
}
