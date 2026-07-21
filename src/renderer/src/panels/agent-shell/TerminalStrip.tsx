import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { borderRadius, colors, typography } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'
import { useThreadStore } from '../../store/thread-store'
import { useFocusedCanvasId } from '../../store/dock-store'
import { useTerminalStripStore } from '../../store/terminal-strip-store'
import type { TerminalStripSession } from '@shared/dock-types'
import { TerminalDockAdapter } from './dock-adapters/TerminalDockAdapter'
import { openStripTerminal, openStripTerminalInFolder, stripToCanvas } from './terminal-migration'

const TAB_ROW_HEIGHT = 30

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

  const [menu, setMenu] = useState<{ position: ContextMenuPosition; tabId: string } | null>(null)
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
  const menuSession = menu ? sessions.find((s) => s.tabId === menu.tabId) : undefined

  return (
    <div
      data-testid="terminal-strip"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: hasVisibleSessions ? `1px solid ${colors.tab.border}` : 'none',
        background: colors.bg.rail
      }}
    >
      {hasVisibleSessions && !collapsed && (
        <div
          data-testid="terminal-strip-resize"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          style={{ height: 4, marginBottom: -4, cursor: 'row-resize', zIndex: 1 }}
        />
      )}
      <div
        data-testid="terminal-strip-tabs"
        style={{
          height: TAB_ROW_HEIGHT,
          flexShrink: 0,
          display: hasVisibleSessions ? 'flex' : 'none',
          alignItems: 'center',
          gap: 2,
          padding: '0 6px',
          overflowX: 'auto'
        }}
      >
        {sessions.map((session) => (
          <StripTab
            key={session.tabId}
            session={session}
            active={session.tabId === activeTabId}
            onActivate={() => {
              setActive(threadId, session.tabId)
              if (collapsed) toggleCollapsed(threadId)
            }}
            onClose={() => close(threadId, session.tabId)}
            onContextMenu={(position) => setMenu({ position, tabId: session.tabId })}
          />
        ))}
        <button
          type="button"
          data-testid="terminal-strip-new"
          title="New terminal at workspace root (right-click a tab for more)"
          onClick={() => openStripTerminal()}
          style={iconButtonStyle}
        >
          <Plus size={13} strokeWidth={1.75} aria-hidden />
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="terminal-strip-collapse"
          title={collapsed ? 'Expand terminal strip' : 'Collapse terminal strip'}
          onClick={() => toggleCollapsed(threadId)}
          style={iconButtonStyle}
        >
          {collapsed ? (
            <ChevronUp size={13} strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>
      <div
        style={{
          height: collapsed || !hasVisibleSessions ? 0 : strip.height,
          display: collapsed || !hasVisibleSessions ? 'none' : 'block',
          position: 'relative'
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
            <div key={key} style={{ display: isActive ? 'block' : 'none', height: '100%' }}>
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
      {menu && menuSession && (
        <ContextMenu
          testId="terminal-strip-menu"
          position={menu.position}
          openUpward
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'move-to-canvas',
              label: 'Move to canvas',
              // Targets the FOCUSED canvas only — no last-seen fallback.
              disabled: menuSession.sessionId === '' || focusedCanvasId === null,
              onSelect: () => stripToCanvas(threadId, menuSession.tabId)
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
              onSelect: () => close(threadId, menuSession.tabId)
            }
          ]}
        />
      )}
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

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: borderRadius.inline,
  background: 'transparent',
  color: colors.text.muted,
  cursor: 'pointer',
  flexShrink: 0
}

function StripTab({
  session,
  active,
  onActivate,
  onClose,
  onContextMenu
}: {
  readonly session: TerminalStripSession
  readonly active: boolean
  readonly onActivate: () => void
  readonly onClose: () => void
  readonly onContextMenu: (position: ContextMenuPosition) => void
}) {
  return (
    <div
      data-testid={`terminal-strip-tab-${session.tabId}`}
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu({ x: e.clientX, y: e.clientY })
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 180,
        padding: '3px 6px 3px 8px',
        borderRadius: borderRadius.inline,
        background: active ? 'var(--bg-tint-text)' : 'transparent',
        color: active ? colors.text.primary : colors.text.secondary,
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.metadata.size,
        letterSpacing: typography.metadata.letterSpacing,
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <span
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={session.cwd}
      >
        {basename(session.cwd)}
      </span>
      <button
        type="button"
        aria-label={`Close terminal ${basename(session.cwd)}`}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        style={{ ...iconButtonStyle, width: 16, height: 16 }}
      >
        <X size={11} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}
