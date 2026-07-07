import { useEffect, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useCliSessionStore } from '../../store/cli-session-store'
import { ThreadMessage } from './ThreadMessage'
import { ThreadInputBar } from './ThreadInputBar'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors, borderRadius, transitions, typography, floatingPanel } from '../../design/tokens'
import { AgentBadge } from './agent-badge'
import { WatcherHealthChip, WatcherHealthNotice } from './WatcherHealthChip'
import { HarnessIdentityChip } from './HarnessIdentityChip'
import { ThinkingIndicator } from './ThinkingIndicator'
import { TerminalDockAdapter } from './dock-adapters/TerminalDockAdapter'

/** The two projections of one CLI agent session (contracts §3, Phase 2 step 4). */
type ProjectionMode = 'thread' | 'raw'

const AT_BOTTOM_THRESHOLD_PX = 40

interface ThreadPanelProps {
  /**
   * Fixed pixel width. When omitted the panel flexes to fill the row — used
   * when the dock is collapsed and chat is the only remaining surface.
   */
  readonly width?: number
}

export function ThreadPanel({ width }: ThreadPanelProps = {}) {
  // Fixed mode still allows shrink-to-min: when the window is too narrow for
  // every pane's preferred width, chat gives way first (down to 320) instead
  // of pushing the files panel off-screen.
  const sizing =
    width === undefined
      ? ({ flex: 1, minWidth: 320 } as const)
      : ({ width, minWidth: 320, flexShrink: 1 } as const)
  const activeId = useThreadStore((s) => s.activeThreadId)
  const t = useThreadStore((s) => (activeId ? (s.threadsById[activeId] ?? null) : null))
  const streaming = useThreadStore((s) =>
    activeId ? (s.streamingByThreadId[activeId] ?? null) : null
  )
  const pendingTools = useThreadStore((s) =>
    activeId ? (s.pendingToolCallsByThreadId[activeId] ?? null) : null
  )
  const inFlight = useThreadStore((s) => (t ? s.inFlightByThreadId[t.id] === true : false))
  const toggleAutoAccept = useThreadStore((s) => s.toggleAutoAccept)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Projection toggle (Phase 2 step 4): per-thread, reset to the structured
  // view on thread switch. Render-time prop-derived reset (no effect churn).
  const [projection, setProjection] = useState<{ id: string | null; mode: ProjectionMode }>({
    id: activeId,
    mode: 'thread'
  })
  if (projection.id !== activeId) {
    setProjection({ id: activeId, mode: 'thread' })
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD_PX
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [t?.messages.length, streaming, pendingTools?.length])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD_PX)
  }

  function scrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  if (!t) {
    return (
      <section
        style={{
          ...sizing,
          boxSizing: 'border-box',
          padding: 24,
          color: colors.text.muted,
          background: colors.bg.base,
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform
        }}
      >
        No thread selected.
      </section>
    )
  }

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...sizing,
        height: '100%',
        background: colors.bg.base
      }}
    >
      <header
        style={{
          height: 44,
          padding: '0 20px',
          flexShrink: 0,
          boxSizing: 'border-box',
          borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            flex: 1
          }}
        >
          {streaming !== null && <LiveDot />}
          <span
            style={{
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              color: colors.text.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {t.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t.agent !== 'machina-native' && (
            <ProjectionToggle
              mode={projection.mode}
              onChange={(mode) => setProjection({ id: activeId, mode })}
            />
          )}
          {t.agent !== 'machina-native' && (
            <HarnessIdentityChip threadId={t.id} agentId={t.agentId} />
          )}
          {t.agent !== 'machina-native' && <WatcherHealthChip />}
          {t.agent === 'machina-native' && (
            <AutoAcceptToggle
              on={t.autoAcceptSession === true}
              onClick={() => void toggleAutoAccept(t.id)}
            />
          )}
          <AgentBadge agent={t.agent} />
        </div>
      </header>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {projection.mode === 'raw' && t.agent !== 'machina-native' ? (
          <RawProjectionView threadId={t.id} />
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              style={{ height: '100%', overflowY: 'auto' }}
            >
              {t.messages.length === 0 && !streaming && !pendingTools?.length && !inFlight ? (
                <EmptyState />
              ) : (
                <>
                  {t.messages.map((m, i) => {
                    const isLastAssistant = i === t.messages.length - 1 && m.role === 'assistant'
                    return (
                      <ThreadMessage
                        key={`${t.id}:${i}`}
                        message={m}
                        streamingBody={isLastAssistant ? (streaming ?? undefined) : undefined}
                      />
                    )
                  })}
                  {t.agent !== 'machina-native' && (
                    <WatcherHealthNotice key={t.id} threadId={t.id} />
                  )}
                  <InflightAssistant
                    messages={t.messages}
                    streaming={streaming}
                    pendingTools={pendingTools}
                    inFlight={inFlight}
                  />
                </>
              )}
            </div>
            {!isAtBottom && <ScrollToBottomButton onClick={scrollToBottom} />}
          </>
        )}
      </div>
      <ThreadInputBar />
    </section>
  )
}

/**
 * Segmented thread ⇄ raw switch (Phase 2 step 4): one click between the two
 * projections of the same CLI agent session.
 */
function ProjectionToggle({
  mode,
  onChange
}: {
  readonly mode: ProjectionMode
  readonly onChange: (mode: ProjectionMode) => void
}) {
  const segment = (value: ProjectionMode, label: string) => {
    const active = mode === value
    return (
      <button
        type="button"
        data-testid={`projection-${value}`}
        aria-pressed={active}
        onClick={() => onChange(value)}
        title={
          value === 'raw'
            ? 'Raw view: the live PTY behind this thread. Keystrokes go to the same shell the agent runs in.'
            : 'Structured thread view'
        }
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          padding: '3px 8px',
          border: 'none',
          background: active
            ? 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)'
            : 'transparent',
          color: active ? colors.text.primary : colors.text.muted,
          cursor: 'pointer',
          transition: `background ${transitions.fast}, color ${transitions.fast}`
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      data-testid="projection-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: borderRadius.inline,
        overflow: 'hidden'
      }}
    >
      {segment('thread', 'thread')}
      {segment('raw', 'raw')}
    </div>
  )
}

/**
 * Raw projection (Phase 2 step 4): reattach-only view onto the thread's live
 * PTY, sourced exclusively from the cli-session-store (the single sessionId
 * authority). No live session ⇒ read-only dead state — an agent thread's PTY
 * is NEVER respawned from the view layer (contracts §4).
 */
function RawProjectionView({ threadId }: { readonly threadId: string }) {
  const entry = useCliSessionStore((s) => s.byThread[threadId])
  const hydrate = useCliSessionStore((s) => s.hydrate)
  // Pull hydration covers late subscribers: a renderer reload empties the
  // store while the main-side PTY survives; get-session restores the binding.
  useEffect(() => {
    void hydrate(threadId)
  }, [threadId, hydrate])

  if (!entry || !entry.live) {
    return (
      <div
        role="status"
        data-testid="raw-projection-dead"
        style={{
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: 24,
          gap: 6,
          background: colors.bg.surface,
          fontFamily: typography.fontFamily.mono,
          fontSize: 12,
          lineHeight: 1.6
        }}
      >
        <div
          style={{
            color: colors.text.muted,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform
          }}
        >
          {entry ? 'agent session ended' : 'no agent session'}
        </div>
        <div style={{ color: colors.text.secondary }}>
          {entry
            ? 'This PTY is gone. Machina does not restart shells for agent threads — send a message to start the next turn in a fresh, attributed session.'
            : 'No PTY is running for this thread yet. Send a message to start one.'}
        </div>
      </div>
    )
  }

  return <TerminalDockAdapter sessionId={entry.sessionId} projection="agent" />
}

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        height: '100%',
        padding: '18% 32px 0',
        gap: 12,
        boxSizing: 'border-box'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 1,
          background: colors.accent.line,
          marginBottom: 2,
          opacity: 0.9
        }}
      />
      <h2
        style={{
          margin: 0,
          fontFamily: typography.fontFamily.display,
          fontWeight: 400,
          fontSize: 22,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: colors.text.primary
        }}
      >
        Ask anything about your vault.
      </h2>
      <p
        style={{
          margin: 0,
          maxWidth: 420,
          fontFamily: typography.fontFamily.body,
          fontSize: 13,
          lineHeight: 1.6,
          color: colors.text.muted
        }}
      >
        Cite notes, trace ideas across the graph, or ask the agent to draft from what you already
        wrote.
      </p>
      <div
        style={{
          marginTop: 6,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.disabled
        }}
      >
        <span>type</span>
        <span style={{ color: colors.text.muted }}>/</span>
        <span>to switch agent</span>
      </div>
    </div>
  )
}

function ScrollToBottomButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="scroll to bottom"
      title="Scroll to bottom"
      style={{
        position: 'absolute',
        bottom: 16,
        right: 20,
        width: 28,
        height: 28,
        borderRadius: borderRadius.inline,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        color: colors.text.secondary,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        boxShadow: floatingPanel.shadowCompact,
        transition: `color ${transitions.fast}, border-color ${transitions.fast}`
      }}
    >
      <svg
        width={12}
        height={12}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 5l3 3 3-3" />
      </svg>
    </button>
  )
}

function AutoAcceptToggle({ on, onClick }: { readonly on: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        on
          ? 'Auto-accept on: writes apply without approval'
          : 'Auto-accept off: writes require approval'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.metadata.size,
        letterSpacing: typography.metadata.letterSpacing,
        textTransform: typography.metadata.textTransform,
        padding: '4px 10px',
        borderRadius: borderRadius.inline,
        border: `1px solid ${on ? colors.accent.default : colors.border.subtle}`,
        background: on
          ? 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)'
          : 'transparent',
        color: on ? colors.text.primary : colors.text.muted,
        cursor: 'pointer',
        transition: `background ${transitions.fast}, border-color ${transitions.fast}, color ${transitions.fast}`
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 12,
          borderRadius: borderRadius.inline,
          background: on
            ? colors.accent.default
            : 'color-mix(in srgb, var(--color-text-primary) 18%, transparent)',
          position: 'relative',
          flexShrink: 0,
          transition: `background ${transitions.fast}`
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 12 : 2,
            width: 8,
            height: 8,
            borderRadius: borderRadius.inline,
            background: on ? colors.bg.base : colors.text.primary,
            transition: `left ${transitions.fast}, background ${transitions.fast}`
          }}
        />
      </span>
      <span>auto-accept</span>
    </button>
  )
}

function LiveDot() {
  return (
    <span
      aria-hidden
      data-testid="thread-live-dot"
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: colors.accent.default,
        flexShrink: 0,
        animation: 'te-pulse 1.4s ease-in-out infinite'
      }}
    />
  )
}

function InflightAssistant({
  messages,
  streaming,
  pendingTools,
  inFlight
}: {
  readonly messages: ReadonlyArray<{ role: string }>
  readonly streaming: string | null
  readonly pendingTools: ReadonlyArray<{
    call: import('@shared/thread-types').ToolCall
    result?: import('@shared/thread-types').ToolResult
  }> | null
  readonly inFlight: boolean
}) {
  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') return null
  const hasText = streaming !== null && streaming.length > 0
  const hasTools = pendingTools !== null && pendingTools.length > 0
  if (!hasText && !hasTools && !inFlight) return null
  return (
    <article
      data-role="assistant"
      data-inflight="true"
      style={{ padding: '20px 24px', borderBottom: `1px solid ${colors.border.subtle}` }}
    >
      <div
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted,
          marginBottom: 8
        }}
      >
        Machina
      </div>
      {!hasText && !hasTools && <ThinkingIndicator />}
      {hasText && (
        <div className="thread-prose" style={{ whiteSpace: 'pre-wrap' }}>
          {streaming}
        </div>
      )}
      {hasTools &&
        pendingTools!.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} />
        ))}
    </article>
  )
}
