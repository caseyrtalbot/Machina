import { useEffect, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useCliSessionStore } from '../../store/cli-session-store'
import { ThreadMessage } from './ThreadMessage'
import { ThreadInputBar } from './ThreadInputBar'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { AgentBadge } from './agent-badge'
import { WatcherHealthChip, WatcherHealthNotice } from './WatcherHealthChip'
import { HarnessIdentityChip } from './HarnessIdentityChip'
import { AgentKillSwitch } from './agent-breaker-kill-switch'
import { ThinkingIndicator } from './ThinkingIndicator'
import { EmptyState } from '../../components/emptystate/EmptyState'
import { PanelHeader } from '../../components/panelheader/PanelHeader'
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
      <section className="te-thread-empty-section" style={sizing}>
        No thread selected.
      </section>
    )
  }

  return (
    <section className="te-thread-panel" style={sizing}>
      <PanelHeader
        leading={streaming !== null ? <LiveDot /> : undefined}
        title={t.title}
        trailing={
          <>
            {t.agent !== 'machina-native' && (
              <ProjectionToggle
                mode={projection.mode}
                onChange={(mode) => setProjection({ id: activeId, mode })}
              />
            )}
            {t.agent !== 'machina-native' && (
              <HarnessIdentityChip threadId={t.id} agentId={t.agentId} />
            )}
            {/* Kill switch + breaker-tripped chip (Phase 2 step 6): the hard
              kill (cli-thread:close), distinct from the input bar's Stop. */}
            {t.agent !== 'machina-native' && <AgentKillSwitch threadId={t.id} />}
            {t.agent !== 'machina-native' && <WatcherHealthChip />}
            {t.agent === 'machina-native' && (
              <AutoAcceptToggle
                on={t.autoAcceptSession === true}
                onClick={() => void toggleAutoAccept(t.id)}
              />
            )}
            <AgentBadge agent={t.agent} />
          </>
        }
      />
      <div className="te-thread-panel__body">
        {projection.mode === 'raw' && t.agent !== 'machina-native' ? (
          <RawProjectionView threadId={t.id} />
        ) : (
          <>
            <div ref={scrollRef} onScroll={handleScroll} className="te-thread-scroll">
              {t.messages.length === 0 && !streaming && !pendingTools?.length && !inFlight ? (
                <EmptyThreadState />
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
        className="te-thread-seg"
      >
        {label}
      </button>
    )
  }
  return (
    <div data-testid="projection-toggle" className="te-thread-seg-group">
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
      <div role="status" data-testid="raw-projection-dead" className="te-thread-raw-dead">
        <div className="te-thread-raw-dead__label">
          {entry ? 'agent session ended' : 'no agent session'}
        </div>
        <div className="te-thread-raw-dead__body">
          {entry
            ? 'This PTY is gone. Machina does not restart shells for agent threads — send a message to start the next turn in a fresh, attributed session.'
            : 'No PTY is running for this thread yet. Send a message to start one.'}
        </div>
      </div>
    )
  }

  return <TerminalDockAdapter sessionId={entry.sessionId} projection="agent" />
}

function EmptyThreadState() {
  return (
    <EmptyState
      align="start"
      icon={<span aria-hidden className="te-thread-empty-icon" />}
      title="Ask anything about your vault."
      body={
        <span className="te-thread-empty-body">
          Cite notes, trace ideas across the graph, or ask the agent to draft from what you already
          wrote.
        </span>
      }
      hint={
        <span className="te-thread-empty-hint">
          <span>type</span>
          <span className="te-thread-empty-hint__slash">/</span>
          <span>to switch agent</span>
        </span>
      }
    />
  )
}

function ScrollToBottomButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="scroll to bottom"
      title="Scroll to bottom"
      className="te-thread-scrollbtn"
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
      className="te-thread-autoaccept"
      data-on={on ? 'true' : undefined}
    >
      <span aria-hidden className="te-thread-autoaccept__track">
        <span className="te-thread-autoaccept__knob" />
      </span>
      <span>auto-accept</span>
    </button>
  )
}

function LiveDot() {
  return <span aria-hidden data-testid="thread-live-dot" className="te-thread-livedot" />
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
    <article data-role="assistant" data-inflight="true" className="te-thread-msg">
      <div className="te-thread-msg__label">Machina</div>
      {!hasText && !hasTools && <ThinkingIndicator />}
      {hasText && <div className="thread-prose te-thread-streaming-body">{streaming}</div>}
      {hasTools &&
        pendingTools!.map((tc, i) => (
          <ToolCallRenderer key={tc.call.id ?? i} call={tc.call} result={tc.result} />
        ))}
    </article>
  )
}
