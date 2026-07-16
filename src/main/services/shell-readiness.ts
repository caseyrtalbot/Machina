/**
 * Main-side shell-readiness tracker (workstation Phase 3 step 4). Replicates
 * the renderer block-store poll (store/harness-run.ts:34-44) on BlockWatcher's
 * block transitions: a fresh PTY is "ready" once its first block appears — for
 * a fresh shell that is the prompt-start pending block, i.e. the shell prompt
 * has been drawn (the Phase-1 step-6 lost-reply signal). Event-driven, not
 * polled: ipc/shell.ts taps markBlockSeen on every block snapshot and
 * clearSession on PTY exit. Leaf module — no Electron imports.
 */

/** Mirrors the renderer poll's bound (store/harness-run.ts SHELL_READY_TIMEOUT_MS). */
const SHELL_READY_TIMEOUT_MS = 10_000

/** Sessions that have emitted at least one block snapshot. */
const seenSessions = new Set<string>()
/** Pending waiters per session, each settled exactly once. */
const waiters = new Map<string, Array<(ready: boolean) => void>>()

function settleWaiters(sessionId: string, ready: boolean): void {
  const pending = waiters.get(sessionId)
  if (pending === undefined) return
  waiters.delete(sessionId)
  for (const resolve of pending) resolve(ready)
}

/** Tap: called from shell.ts blockWatcher onUpdate for every block snapshot. */
export function markBlockSeen(sessionId: string): void {
  seenSessions.add(sessionId)
  settleWaiters(sessionId, true)
}

/** Tap: called from shell.ts terminal-exit callback; settles pending waiters false. */
export function clearSession(sessionId: string): void {
  seenSessions.delete(sessionId)
  settleWaiters(sessionId, false)
}

/**
 * True when the session has emitted ≥1 block (immediately if already seen);
 * false on timeout or session exit. Never rejects — the caller sends anyway,
 * preserving the renderer poll's bounded-best-effort semantics
 * (harness-run.ts returns void on timeout and the caller sends).
 */
export function waitForFirstBlock(
  sessionId: string,
  timeoutMs = SHELL_READY_TIMEOUT_MS
): Promise<boolean> {
  if (seenSessions.has(sessionId)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const waiter = (ready: boolean): void => {
      clearTimeout(timer)
      resolve(ready)
    }
    const timer = setTimeout(() => {
      const pending = waiters.get(sessionId)
      if (pending !== undefined) {
        const remaining = pending.filter((w) => w !== waiter)
        if (remaining.length > 0) waiters.set(sessionId, remaining)
        else waiters.delete(sessionId)
      }
      resolve(false)
    }, timeoutMs)
    waiters.set(sessionId, [...(waiters.get(sessionId) ?? []), waiter])
  })
}
