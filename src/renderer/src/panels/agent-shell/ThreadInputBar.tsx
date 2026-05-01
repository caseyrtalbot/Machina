import { useState, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { AgentPicker } from './AgentPicker'
import type { AgentIdentity } from '@shared/agent-identity'
import { colors } from '../../design/tokens'

export function ThreadInputBar() {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const threadsById = useThreadStore((s) => s.threadsById)
  const appendUser = useThreadStore((s) => s.appendUserMessage)
  const createThread = useThreadStore((s) => s.createThread)
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const isThreadStart = activeId ? threadsById[activeId]?.messages.length === 0 : false

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (text === '' && e.key === '/' && isThreadStart) {
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
        padding: 12
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
          width: '100%',
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
    </div>
  )
}
