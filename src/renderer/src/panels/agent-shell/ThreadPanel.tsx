import { useEffect, useRef } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { ThreadMessage } from './ThreadMessage'
import { ThreadInputBar } from './ThreadInputBar'
import { ToolCallRenderer } from './tool-renderers/ToolCallRenderer'
import { colors, borderRadius } from '../../design/tokens'

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

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [t?.messages.length, streaming, pendingTools?.length])

  if (!t) {
    return (
      <section
        style={{
          flex: 1,
          minWidth: 480,
          padding: 24,
          color: colors.text.muted
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
        height: '100%'
      }}
    >
      <header
        style={{
          padding: 12,
          borderBottom: `1px solid ${colors.border.default}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12
        }}
      >
        <span>{t.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t.agent === 'machina-native' && (
            <button
              onClick={() => void toggleAutoAccept(t.id)}
              title={
                t.autoAcceptSession
                  ? 'Auto-accept on: writes apply without approval'
                  : 'Auto-accept off: writes require approval'
              }
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: borderRadius.inline,
                border: `1px solid ${colors.border.default}`,
                background: t.autoAcceptSession ? colors.bg.elevated : 'transparent',
                color: t.autoAcceptSession ? colors.text.primary : colors.text.muted,
                cursor: 'pointer'
              }}
            >
              Auto-accept: {t.autoAcceptSession ? 'on' : 'off'}
            </button>
          )}
          <span style={{ fontSize: 11, color: colors.text.muted }}>{t.agent}</span>
        </div>
      </header>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
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
      </div>
      <ThreadInputBar />
    </section>
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
      style={{ padding: 16, borderBottom: `1px solid ${colors.border.subtle}` }}
    >
      <h3
        style={{
          fontSize: 11,
          color: colors.text.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          margin: 0,
          marginBottom: 4
        }}
      >
        Machina
      </h3>
      {hasText && (
        <div className="prose" style={{ whiteSpace: 'pre-wrap' }}>
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
