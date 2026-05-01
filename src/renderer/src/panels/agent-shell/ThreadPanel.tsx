import { useEffect, useRef } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { ThreadMessage } from './ThreadMessage'
import { ThreadInputBar } from './ThreadInputBar'
import { colors } from '../../design/tokens'

export function ThreadPanel() {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const t = useThreadStore((s) => (activeId ? (s.threadsById[activeId] ?? null) : null))
  const streaming = useThreadStore((s) =>
    activeId ? (s.streamingByThreadId[activeId] ?? null) : null
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [t?.messages.length, streaming])

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
          justifyContent: 'space-between'
        }}
      >
        <span>{t.title}</span>
        <span style={{ fontSize: 11, color: colors.text.muted }}>{t.agent}</span>
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
      </div>
      <ThreadInputBar />
    </section>
  )
}
