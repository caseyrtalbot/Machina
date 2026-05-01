import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreadMessage } from '../ThreadMessage'
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
})
