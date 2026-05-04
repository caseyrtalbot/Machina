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
  const [focused, setFocused] = useState(false)
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
        padding: '14px 16px 16px',
        background: colors.bg.base
      }}
    >
      {pickerOpen && <AgentPicker onPick={pickAgent} onCancel={() => setPickerOpen(false)} />}
      <div
        className="thread-input-box"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          padding: '12px 14px 12px 16px',
          background: colors.bg.surface,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: borderRadius.tool,
          transition: `background ${transitions.fast}, border-color ${transitions.fast}`
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: 13,
            lineHeight: '22px',
            userSelect: 'none'
          }}
        >
          ›
        </span>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ask anything about your vault…"
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
            lineHeight: 1.55
          }}
        />
        {inFlight && activeId ? (
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
        ) : (
          <KeyHint visible={!focused && text.length === 0} />
        )}
      </div>
    </div>
  )
}

function KeyHint({ visible }: { readonly visible: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        opacity: visible ? 1 : 0,
        transition: `opacity ${transitions.fast}`,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: colors.text.disabled,
        lineHeight: '22px',
        userSelect: 'none'
      }}
    >
      <Kbd>⌘K</Kbd>
      <span style={{ color: colors.text.disabled }}>·</span>
      <Kbd>/</Kbd>
    </span>
  )
}

function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 3,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        color: colors.text.muted,
        background: 'transparent'
      }}
    >
      {children}
    </span>
  )
}
