import { useState, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { AgentPicker } from './AgentPicker'
import type { AgentIdentity } from '@shared/agent-identity'
import { borderRadius, colors } from '../../design/tokens'

export function ThreadInputBar() {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const appendUser = useThreadStore((s) => s.appendUserMessage)
  const createThread = useThreadStore((s) => s.createThread)
  const cancelActive = useThreadStore((s) => s.cancelActive)
  const inFlight = useThreadStore((s) =>
    activeId ? Boolean(s.inFlightByThreadId[activeId]) : false
  )
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (text === '' && e.key === '/') {
      e.preventDefault()
      setPickerOpen(true)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim().length === 0) return
      void appendUser(text)
      setText('')
    }
  }

  async function pickAgent(a: AgentIdentity) {
    setPickerOpen(false)
    await createThread(a, 'claude-sonnet-4-6')
    ref.current?.focus()
  }

  return (
    <div
      style={{
        position: 'relative',
        borderTop: `1px solid ${colors.border.default}`,
        padding: 12,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8
      }}
    >
      {pickerOpen && <AgentPicker onPick={pickAgent} onCancel={() => setPickerOpen(false)} />}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask anything…   Cmd+K · /"
        style={{
          flex: 1,
          resize: 'none',
          minHeight: 32,
          background: 'transparent',
          color: colors.text.primary,
          border: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          fontSize: 14
        }}
      />
      {inFlight && activeId && (
        <button
          type="button"
          data-testid="thread-input-stop"
          aria-label="Stop"
          title="Stop the in-flight agent run"
          onClick={() => void cancelActive(activeId)}
          style={{
            flexShrink: 0,
            padding: '4px 12px',
            background: 'transparent',
            border: `1px solid ${colors.border.default}`,
            borderRadius: borderRadius.inline,
            color: colors.text.secondary,
            cursor: 'pointer',
            fontSize: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: colors.claude.error,
              borderRadius: 1
            }}
          />
          Stop
        </button>
      )}
    </div>
  )
}
