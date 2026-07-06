import { create } from 'zustand'
import {
  DEFAULT_TERMINAL_STRIP,
  type TerminalStripSession,
  type TerminalStripState
} from '@shared/dock-types'
import { sessionId as toSessionId } from '@shared/types'

/**
 * Per-thread terminal strip state (workstation step 4). Persistence rides the
 * thread file: thread-store seeds this store on load, folds it into
 * `dockState.terminalStrip` on flush, and drops the entry on thread delete.
 * This store must not import thread-store (thread-store imports it).
 */
/** A session closed before its sessionId arrived — see pendingKill below. */
export interface PendingKillEntry extends TerminalStripSession {
  readonly threadId: string
}

interface TerminalStripStoreState {
  byThreadId: Record<string, TerminalStripState>
  /**
   * Closing an unbound tab (sessionId still '') cannot kill its PTY yet — the
   * guest reports session-created only after terminal:create resolves. These
   * entries leave the tab row immediately but keep their webview mounted
   * (hidden) until the id arrives and resolvePendingKill kills the PTY.
   * Runtime-only: never persisted (lives outside TerminalStripState).
   */
  pendingKill: readonly PendingKillEntry[]

  /** Add a fresh session at cwd, activate it, expand the strip. Returns tabId. */
  spawn: (threadId: string, cwd: string) => string
  /**
   * Record the sessionId the webview reported. Overwrites any persisted value —
   * a stale sessionId falls through terminal:reconnect, respawns fresh at cwd,
   * and lands here with the replacement id.
   */
  bindSession: (threadId: string, tabId: string, sessionId: string) => void
  /** Close the tab and kill its PTY (the strip owns plain terminals it spawned). */
  close: (threadId: string, tabId: string) => void
  /** Kill the late-reported PTY of a closed-while-unbound tab and forget it. */
  resolvePendingKill: (tabId: string, sessionId: string) => void
  /** Forget a pendingKill entry whose PTY never materialized (exit/load failure). */
  discardPendingKill: (tabId: string) => void
  /** Remove the tab WITHOUT killing the PTY — the migration seam. Returns the session. */
  detach: (threadId: string, tabId: string) => TerminalStripSession | null
  /** Adopt an existing live session (canvas→strip migration). Returns tabId. */
  attach: (threadId: string, session: { sessionId: string; cwd: string }) => string
  setActive: (threadId: string, tabId: string) => void
  toggleCollapsed: (threadId: string) => void
  setHeight: (threadId: string, height: number) => void
  /**
   * Restore persisted strip state on thread load. First-write-wins: a no-op
   * when the thread already has in-memory state, because loadThreads also
   * re-runs mid-session (unarchive, vault re-open) with disk state that is
   * only current as of the last flush — it must never clobber live sessions.
   */
  seed: (threadId: string, state: TerminalStripState | undefined) => void
  /** Kill the thread's bound PTYs and forget its strip state (thread deleted). */
  drop: (threadId: string) => void
}

/** Strip body pixel bounds. Max is window-relative so the dock stays usable. */
export const STRIP_MIN_HEIGHT = 120
const STRIP_MAX_RATIO = 0.6

export function clampStripHeight(h: number): number {
  const innerHeight = typeof window === 'undefined' ? 1080 : window.innerHeight
  const max = Math.max(STRIP_MIN_HEIGHT, Math.floor(innerHeight * STRIP_MAX_RATIO))
  return Math.max(STRIP_MIN_HEIGHT, Math.min(max, Math.round(h)))
}

function stripOf(s: TerminalStripStoreState, threadId: string): TerminalStripState {
  return s.byThreadId[threadId] ?? DEFAULT_TERMINAL_STRIP
}

function withStrip(
  s: TerminalStripStoreState,
  threadId: string,
  next: TerminalStripState
): Pick<TerminalStripStoreState, 'byThreadId'> {
  return { byThreadId: { ...s.byThreadId, [threadId]: next } }
}

export const useTerminalStripStore = create<TerminalStripStoreState>((set, get) => ({
  byThreadId: {},
  pendingKill: [],

  spawn: (threadId, cwd) => {
    const tabId = globalThis.crypto.randomUUID()
    set((s) => {
      const strip = stripOf(s, threadId)
      return withStrip(s, threadId, {
        ...strip,
        sessions: [...strip.sessions, { tabId, sessionId: '', cwd }],
        activeTabId: tabId,
        collapsed: false
      })
    })
    return tabId
  },

  bindSession: (threadId, tabId, sessionId) =>
    set((s) => {
      const strip = stripOf(s, threadId)
      if (!strip.sessions.some((sess) => sess.tabId === tabId)) return s
      return withStrip(s, threadId, {
        ...strip,
        sessions: strip.sessions.map((sess) =>
          sess.tabId === tabId ? { ...sess, sessionId } : sess
        )
      })
    }),

  close: (threadId, tabId) => {
    const strip = stripOf(get(), threadId)
    const target = strip.sessions.find((sess) => sess.tabId === tabId)
    if (!target) return
    if (target.sessionId) {
      void window.api.terminal.kill(toSessionId(target.sessionId))
      set((s) => removeTab(s, threadId, tabId))
      return
    }
    // Unbound: the PTY is (or is about to be) alive in main but we do not know
    // its id yet. Park the session so its webview stays mounted until
    // session-created arrives and resolvePendingKill can kill by real id.
    set((s) => ({
      ...removeTab(s, threadId, tabId),
      pendingKill: [...s.pendingKill, { ...target, threadId }]
    }))
  },

  resolvePendingKill: (tabId, sessionId) => {
    const entry = get().pendingKill.find((e) => e.tabId === tabId)
    if (!entry) return
    if (sessionId) {
      void window.api.terminal.kill(toSessionId(sessionId))
    }
    set((s) => ({ pendingKill: s.pendingKill.filter((e) => e.tabId !== tabId) }))
  },

  discardPendingKill: (tabId) =>
    set((s) =>
      s.pendingKill.some((e) => e.tabId === tabId)
        ? { pendingKill: s.pendingKill.filter((e) => e.tabId !== tabId) }
        : s
    ),

  detach: (threadId, tabId) => {
    const strip = stripOf(get(), threadId)
    const target = strip.sessions.find((sess) => sess.tabId === tabId)
    if (!target) return null
    // No terminal.kill here — the PTY survives and the next surface reconnects.
    set((s) => removeTab(s, threadId, tabId))
    return target
  },

  attach: (threadId, session) => {
    const tabId = globalThis.crypto.randomUUID()
    set((s) => {
      const strip = stripOf(s, threadId)
      return withStrip(s, threadId, {
        ...strip,
        sessions: [...strip.sessions, { tabId, sessionId: session.sessionId, cwd: session.cwd }],
        activeTabId: tabId,
        collapsed: false
      })
    })
    return tabId
  },

  setActive: (threadId, tabId) =>
    set((s) => {
      const strip = stripOf(s, threadId)
      if (!strip.sessions.some((sess) => sess.tabId === tabId)) return s
      return withStrip(s, threadId, { ...strip, activeTabId: tabId })
    }),

  toggleCollapsed: (threadId) =>
    set((s) => {
      const strip = stripOf(s, threadId)
      return withStrip(s, threadId, { ...strip, collapsed: !strip.collapsed })
    }),

  setHeight: (threadId, height) =>
    set((s) => {
      const strip = stripOf(s, threadId)
      return withStrip(s, threadId, { ...strip, height: clampStripHeight(height) })
    }),

  seed: (threadId, state) =>
    set((s) => {
      if (!state || threadId in s.byThreadId) return s
      return withStrip(s, threadId, { ...state, height: clampStripHeight(state.height) })
    }),

  drop: (threadId) => {
    const strip = get().byThreadId[threadId]
    if (!strip) return
    // The deleted thread's strip sessions have no surviving UI reference —
    // kill their PTYs or they run headless for the rest of the app lifetime.
    for (const sess of strip.sessions) {
      if (sess.sessionId) void window.api.terminal.kill(toSessionId(sess.sessionId))
    }
    set((s) => {
      const next = { ...s.byThreadId }
      delete next[threadId]
      // Sweep this thread's pendingKill entries too: their webviews unmount
      // with the thread, so session-created can never arrive to resolve them.
      return { byThreadId: next, pendingKill: s.pendingKill.filter((e) => e.threadId !== threadId) }
    })
  }
}))

function removeTab(
  s: TerminalStripStoreState,
  threadId: string,
  tabId: string
): Pick<TerminalStripStoreState, 'byThreadId'> | TerminalStripStoreState {
  const strip = stripOf(s, threadId)
  const sessions = strip.sessions.filter((sess) => sess.tabId !== tabId)
  if (sessions.length === strip.sessions.length) return s
  const activeTabId =
    strip.activeTabId === tabId ? (sessions[sessions.length - 1]?.tabId ?? null) : strip.activeTabId
  return withStrip(s, threadId, { ...strip, sessions, activeTabId })
}
