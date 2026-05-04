import { useState, useRef, useLayoutEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { AgentPicker } from './AgentPicker'
import type { AgentIdentity } from '@shared/agent-identity'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'

const MIN_INPUT_HEIGHT = 22
const MAX_INPUT_HEIGHT = 200

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

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, el.scrollHeight))
    el.style.height = `${next}px`
  }, [text])

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
        borderTop: `1px solid ${colors.border.subtle}`,
        padding: 12,
        background: colors.bg.base
      }}
    >
      {pickerOpen && <AgentPicker onPick={pickAgent} onCancel={() => setPickerOpen(false)} />}
      <div
        className="thread-input-box"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '10px 12px',
          background: colors.bg.surface,
          border: `1px solid ${colors.border.default}`,
          borderRadius: borderRadius.inline,
          transition: `border-color ${transitions.fast}, box-shadow ${transitions.fast}`
        }}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="ASK ANYTHING…   CMD+K · /"
          className="thread-input-textarea"
          style={{
            flex: 1,
            resize: 'none',
            minHeight: MIN_INPUT_HEIGHT,
            maxHeight: MAX_INPUT_HEIGHT,
            background: 'transparent',
            color: colors.text.primary,
            border: 'none',
            outline: 'none',
            padding: 0,
            fontFamily: typography.fontFamily.body,
            fontSize: 14,
            lineHeight: 1.5
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
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${colors.border.default}`,
              borderRadius: borderRadius.inline,
              color: colors.text.secondary,
              cursor: 'pointer',
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
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
                borderRadius: borderRadius.card
              }}
            />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
