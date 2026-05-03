import { useEffect, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { ThreadMessage } from './ThreadMessage'
import { ThreadInputBar } from './ThreadInputBar'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors, borderRadius, typography } from '../../design/tokens'
import { AgentBadge } from './agent-badge'

const AT_BOTTOM_THRESHOLD_PX = 40

export function ThreadPanel() {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const t = useThreadStore((s) => (activeId ? (s.threadsById[activeId] ?? null) : null))
  const streaming = useThreadStore((s) =>
    activeId ? (s.streamingByThreadId[activeId] ?? null) : null
  )
  const pendingTools = useThreadStore((s) =>
    activeId ? (s.pendingToolCallsByThreadId[activeId] ?? null) : null
  )
  const toggleAutoAccept = useThreadStore((s) => s.toggleAutoAccept)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

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
          flex: 1,
          minWidth: 480,
          padding: 24,
          color: colors.text.muted,
          background: colors.bg.base
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
        flex: 1,
        minWidth: 480,
        height: '100%',
        background: colors.bg.base
      }}
    >
      <header
        style={{
          padding: '12px 20px',
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
              fontFamily: typography.fontFamily.body,
              fontSize: 14,
              fontWeight: 500,
              color: colors.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {t.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
        <div ref={scrollRef} onScroll={handleScroll} style={{ height: '100%', overflowY: 'auto' }}>
          {t.messages.length === 0 && !streaming && !pendingTools?.length ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: colors.text.muted,
                fontFamily: typography.fontFamily.body,
                fontSize: 13
              }}
            >
              Ask anything about your vault.
            </div>
          ) : (
            <>
              {t.messages.map((m, i) => {
                const isLastAssistant = i === t.messages.length - 1 && m.role === 'assistant'
                return (
                  <ThreadMessage
                    key={i}
                    message={m}
                    streamingBody={isLastAssistant ? (streaming ?? undefined) : undefined}
                  />
                )
              })}
              <InflightAssistant
                messages={t.messages}
                streaming={streaming}
                pendingTools={pendingTools}
              />
            </>
          )}
        </div>
        {!isAtBottom && <ScrollToBottomButton onClick={scrollToBottom} />}
      </div>
      <ThreadInputBar />
    </section>
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
        borderRadius: borderRadius.round,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        color: colors.text.secondary,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        transition: 'color 120ms ease-out, border-color 120ms ease-out'
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
        transition: 'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 12,
          borderRadius: 999,
          background: on
            ? colors.accent.default
            : 'color-mix(in srgb, var(--color-text-primary) 18%, transparent)',
          position: 'relative',
          flexShrink: 0,
          transition: 'background 120ms ease-out'
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 12 : 2,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: on ? colors.bg.base : colors.text.primary,
            transition: 'left 120ms ease-out, background 120ms ease-out'
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
  pendingTools
}: {
  readonly messages: ReadonlyArray<{ role: string }>
  readonly streaming: string | null
  readonly pendingTools: ReadonlyArray<{
    call: import('@shared/thread-types').ToolCall
    result?: import('@shared/thread-types').ToolResult
  }> | null
}) {
  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') return null
  const hasText = streaming !== null && streaming.length > 0
  const hasTools = pendingTools !== null && pendingTools.length > 0
  if (!hasText && !hasTools) return null
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
          marginBottom: 10
        }}
      >
        Machina
      </div>
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
