import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { TabBar, type TabBarItem } from '../../components/tabbar/TabBar'
import type { ContextMenuEntry } from '../../components/ContextMenu'
import { useThreadStore } from '../../store/thread-store'
import { useFocusedCanvasId } from '../../store/dock-store'
import { useTerminalStripStore } from '../../store/terminal-strip-store'
import type { TerminalStripSession } from '@shared/dock-types'
import { TerminalDockAdapter } from './dock-adapters/TerminalDockAdapter'
import { openStripTerminal, openStripTerminalInFolder, stripToCanvas } from './terminal-migration'

function basename(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? '/'
}

/**
 * Bottom terminal strip of the SurfaceDock (workstation step 4). Sessions are
 * per-thread (persisted via dockState.terminalStrip); visited tabs stay
 * mounted display:none — the SurfaceDock mountedIds pattern — so switching
 * tabs never tears down a live xterm.
 */
export function TerminalStrip() {
  const threadId = useThreadStore((s) => s.activeThreadId)
  const strip = useTerminalStripStore((s) => (threadId ? s.byThreadId[threadId] : undefined))
  const setHeight = useTerminalStripStore((s) => s.setHeight)
  const setActive = useTerminalStripStore((s) => s.setActive)
  const toggleCollapsed = useTerminalStripStore((s) => s.toggleCollapsed)
  const close = useTerminalStripStore((s) => s.close)
  const bindSession = useTerminalStripStore((s) => s.bindSession)
  const detach = useTerminalStripStore((s) => s.detach)
  const pendingKill = useTerminalStripStore((s) => s.pendingKill)
  const resolvePendingKill = useTerminalStripStore((s) => s.resolvePendingKill)
  const discardPendingKill = useTerminalStripStore((s) => s.discardPendingKill)

  const focusedCanvasId = useFocusedCanvasId()

  // Closed-while-unbound sessions of the ACTIVE thread stay rendered (hidden,
  // same key, same parent — the mounted webview instance must survive) until
  // session-created reports the PTY id to kill. Entries from other threads are
  // unresolvable: their webview unmounted with the thread switch.
  const threadPendingKill = pendingKill.filter((e) => e.threadId === threadId)
  useEffect(() => {
    for (const e of pendingKill) {
      if (e.threadId !== threadId) discardPendingKill(e.tabId)
    }
  }, [pendingKill, threadId, discardPendingKill])

  // Visited-tab mount tracking, synced during render (SurfaceDock pattern).
  const [mountedIds, setMountedIds] = useState<readonly string[]>([])
  const sessions = strip?.sessions ?? []
  const activeTabId = strip?.activeTabId ?? null
  const openIds = new Set([...sessions, ...threadPendingKill].map((s) => `${threadId}:${s.tabId}`))
  const activeKey = threadId && activeTabId ? `${threadId}:${activeTabId}` : null
  const nextMounted = mountedIds.filter((k) => openIds.has(k))
  if (activeKey && !nextMounted.includes(activeKey)) nextMounted.push(activeKey)
  for (const e of threadPendingKill) {
    const k = `${threadId}:${e.tabId}`
    if (!nextMounted.includes(k)) nextMounted.push(k)
  }
  if (
    nextMounted.length !== mountedIds.length ||
    !nextMounted.every((k, i) => k === mountedIds[i])
  ) {
    setMountedIds(nextMounted)
  }

  // Drag-resize: top edge handle, pointer-captured.
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!threadId || !strip) return
      dragRef.current = { startY: e.clientY, startHeight: strip.height }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [threadId, strip]
  )
  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || !threadId) return
      setHeight(threadId, drag.startHeight + (drag.startY - e.clientY))
    },
    [threadId, setHeight]
  )
  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  if (!threadId || !strip || (sessions.length === 0 && threadPendingKill.length === 0)) {
    return null
  }
  // No visible tabs but pendingKill webviews still resolving: keep the strip
  // mounted (so those webview instances survive in place) but hide it.
  const hasVisibleSessions = sessions.length > 0
  const collapsed = strip.collapsed

  const items: TabBarItem[] = sessions.map((session) => ({
    id: session.tabId,
    label: basename(session.cwd),
    tooltip: session.cwd,
    closeLabel: `Close terminal ${basename(session.cwd)}`,
    testId: `terminal-strip-tab-${session.tabId}`
  }))

  const contextMenuForTab = (
    item: TabBarItem,
    closeTabs: (ids: readonly string[]) => void
  ): ContextMenuEntry[] => {
    const session = sessions.find((s) => s.tabId === item.id)
    return [
      {
        id: 'move-to-canvas',
        label: 'Move to canvas',
        // Targets the FOCUSED canvas only — no last-seen fallback.
        disabled: !session || session.sessionId === '' || focusedCanvasId === null,
        onSelect: () => stripToCanvas(threadId, item.id)
      },
      {
        id: 'new-terminal-in-folder',
        label: 'New terminal in folder…',
        onSelect: () => void openStripTerminalInFolder()
      },
      { kind: 'separator', id: 'sep' },
      {
        id: 'close',
        label: 'Close terminal',
        destructive: true,
        onSelect: () => closeTabs([item.id])
      }
    ]
  }

  const newTerminalButton = (
    <button
      type="button"
      data-testid="terminal-strip-new"
      title="New terminal at workspace root (right-click a tab for more)"
      onClick={() => openStripTerminal()}
      className="te-term-strip-btn"
    >
      <Plus size={13} strokeWidth={1.75} aria-hidden />
    </button>
  )

  const collapseButton = (
    <button
      type="button"
      data-testid="terminal-strip-collapse"
      title={collapsed ? 'Expand terminal strip' : 'Collapse terminal strip'}
      onClick={() => toggleCollapsed(threadId)}
      className="te-term-strip-btn"
    >
      {collapsed ? (
        <ChevronUp size={13} strokeWidth={1.75} aria-hidden />
      ) : (
        <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
      )}
    </button>
  )

  return (
    <div
      data-testid="terminal-strip"
      className="te-term-strip"
      data-has-sessions={hasVisibleSessions ? 'true' : undefined}
    >
      {hasVisibleSessions && !collapsed && (
        <div
          data-testid="terminal-strip-resize"
          className="te-term-strip-resize"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
        />
      )}
      {hasVisibleSessions && (
        <TabBar
          variant="pill"
          items={items}
          activeId={activeTabId}
          ariaLabel="Terminal sessions"
          testId="terminal-strip-tabs"
          onActivate={(id) => {
            setActive(threadId, id)
            if (collapsed) toggleCollapsed(threadId)
          }}
          onClose={(ids) => {
            for (const id of ids) close(threadId, id)
          }}
          contextMenu={contextMenuForTab}
          contextMenuUpward
          contextMenuTestId="terminal-strip-menu"
          trailing={newTerminalButton}
          actions={collapseButton}
        />
      )}
      <div
        className="te-term-strip-body"
        style={{
          height: collapsed || !hasVisibleSessions ? 0 : strip.height,
          display: collapsed || !hasVisibleSessions ? 'none' : 'block'
        }}
      >
        {/* pendingKill entries render in the SAME keyed map so the live
            webview instance survives the close — a remount would spawn a
            second PTY instead of learning the first one's id. */}
        {[
          ...sessions.map((session) => ({ session, pending: false })),
          ...threadPendingKill.map((session) => ({ session, pending: true }))
        ].map(({ session, pending }) => {
          const key = `${threadId}:${session.tabId}`
          if (!mountedIds.includes(key)) return null
          const isActive = !pending && session.tabId === activeTabId
          return (
            <div
              key={key}
              className="te-term-strip-pane"
              style={{ display: isActive ? 'block' : 'none' }}
            >
              <StripSessionView
                session={session}
                onSessionCreated={
                  pending
                    ? (sid) => resolvePendingKill(session.tabId, sid)
                    : (sid) => bindSession(threadId, session.tabId, sid)
                }
                onSessionExited={
                  pending
                    ? () => discardPendingKill(session.tabId)
                    : () => detach(threadId, session.tabId)
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Captures the launch identity at mount: bindSession updates the store for
 * persistence/migration, but must not re-navigate a live webview. A remount
 * (relaunch, tab re-visit after drop) reads the then-current store value.
 */
function StripSessionView({
  session,
  onSessionCreated,
  onSessionExited
}: {
  readonly session: TerminalStripSession
  readonly onSessionCreated: (sessionId: string) => void
  readonly onSessionExited: () => void
}) {
  const [launch] = useState(session)
  return (
    <TerminalDockAdapter
      sessionId={launch.sessionId}
      cwd={launch.cwd}
      onSessionCreated={onSessionCreated}
      onSessionExited={onSessionExited}
    />
  )
}
