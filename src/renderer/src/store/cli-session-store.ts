import { create } from 'zustand'

/**
 * CLI-thread session authority (workstation Phase 2 step 4, contracts §3/§6).
 *
 * The SINGLE renderer source of truth for "which PTY backs this CLI thread,
 * and is it alive" — the raw projection attaches to exactly this sessionId
 * and NEVER anything else. Fed by three main-side signals only:
 *
 *   - the `cli-thread:spawn` response (seeded by agent-transport.start)
 *   - the `cli-thread:session-changed` event (spawn-on-demand respawn)
 *   - `cli-thread:get-session` (pull hydration for late subscribers)
 *
 * plus `terminal:exit` for liveness. The bridge's `metadata.sessionId` leak
 * (cli-agent-thread-bridge final messages) must NOT feed this store: it
 * arrives only after the first block and goes stale on respawn — the exact
 * two-sources bug this store exists to close.
 *
 * Deliberately a separate small store so thread-store.ts stays untouched.
 */

export interface CliSessionEntry {
  readonly sessionId: string
  /** False once the PTY exited. A dead entry renders the read-only dead
   *  state — agent projections never respawn a shell (contracts §4). */
  readonly live: boolean
}

interface CliSessionState {
  readonly byThread: Readonly<Record<string, CliSessionEntry>>
  /** Seed from a cli-thread:spawn response (a fresh PTY is live). */
  seed: (threadId: string, sessionId: string) => void
  /** Apply a cli-thread:session-changed event (respawn = fresh live PTY). */
  sessionChanged: (threadId: string, sessionId: string) => void
  /** terminal:exit — flip liveness for whichever thread holds `sessionId`. */
  markExited: (sessionId: string) => void
  /** Thread deleted: forget the binding entirely. */
  drop: (threadId: string) => void
  /** Pull hydration via cli-thread:get-session (late subscriber / relaunch). */
  hydrate: (threadId: string) => Promise<void>
}

export const useCliSessionStore = create<CliSessionState>((set) => ({
  byThread: {},

  seed: (threadId, sessionId) =>
    set((s) => ({
      byThread: { ...s.byThread, [threadId]: { sessionId, live: true } }
    })),

  sessionChanged: (threadId, sessionId) =>
    set((s) => ({
      byThread: { ...s.byThread, [threadId]: { sessionId, live: true } }
    })),

  markExited: (sessionId) =>
    set((s) => {
      const hit = Object.entries(s.byThread).find(([, e]) => e.sessionId === sessionId)
      if (!hit || !hit[1].live) return s
      return {
        byThread: { ...s.byThread, [hit[0]]: { sessionId, live: false } }
      }
    }),

  drop: (threadId) =>
    set((s) => {
      if (!(threadId in s.byThread)) return s
      const { [threadId]: _removed, ...rest } = s.byThread
      return { byThread: rest }
    }),

  hydrate: async (threadId) => {
    try {
      const current = await window.api.cliThread.getSession(threadId)
      if (current === null) return
      set((s) => ({
        byThread: {
          ...s.byThread,
          [threadId]: { sessionId: current.sessionId, live: current.live }
        }
      }))
    } catch {
      // Non-critical pull: the store keeps its last snapshot (the raw view
      // then shows the dead state, which is the safe default).
    }
  }
}))

// ---------------------------------------------------------------------------
// Module-level IPC subscriptions (same pattern as block-store): the respawn
// event is the update authority; terminal:exit drives liveness. Guarded so
// plain unit tests can import this module without a preload bridge.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && window.api?.on?.cliThreadSessionChanged) {
  window.api.on.cliThreadSessionChanged(({ threadId, sessionId }) => {
    useCliSessionStore.getState().sessionChanged(threadId, sessionId)
  })
}

if (typeof window !== 'undefined' && window.api?.on?.terminalExit) {
  window.api.on.terminalExit(({ sessionId }) => {
    useCliSessionStore.getState().markExited(sessionId)
  })
}
