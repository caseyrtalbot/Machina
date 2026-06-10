import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThreadMessage, AUTH_ERROR_BODY } from '../ThreadMessage'
import type { ThreadMessage as TM } from '@shared/thread-types'

const userMsg: TM = { role: 'user', body: 'hello', sentAt: '' }
const assistantMsg: TM = { role: 'assistant', body: 'hi', sentAt: '' }

describe('ThreadMessage', () => {
  it('renders a user message with the User heading', () => {
    render(<ThreadMessage message={userMsg} />)
    expect(screen.getByText('User')).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('renders an assistant message with the Machina heading', () => {
    render(<ThreadMessage message={assistantMsg} />)
    expect(screen.getByText('Machina')).toBeTruthy()
    expect(screen.getByText('hi')).toBeTruthy()
  })

  it('appends the streaming buffer if provided and the message is assistant', () => {
    render(<ThreadMessage message={assistantMsg} streamingBody=" there" />)
    expect(screen.getByText('hi there')).toBeTruthy()
  })

  it('renders an "Add API key in Settings" action on the AUTH system message', () => {
    render(<ThreadMessage message={{ role: 'system', body: AUTH_ERROR_BODY, sentAt: '' }} />)
    const btn = screen.getByRole('button', { name: /add api key in settings/i })
    const spy = vi.fn()
    window.addEventListener('te:open-settings', spy)
    fireEvent.click(btn)
    window.removeEventListener('te:open-settings', spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('renders ordinary system messages without the action', () => {
    render(
      <ThreadMessage message={{ role: 'system', body: 'Message not delivered.', sentAt: '' }} />
    )
    expect(screen.queryByRole('button', { name: /add api key/i })).toBeNull()
  })
})
