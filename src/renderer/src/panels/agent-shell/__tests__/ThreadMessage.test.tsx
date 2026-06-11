import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThreadMessage, AUTH_ERROR_BODY } from '../ThreadMessage'
import { useVaultStore } from '../../../store/vault-store'
import { useThreadStore } from '../../../store/thread-store'
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

describe('ThreadMessage — wikilinks', () => {
  beforeEach(() => {
    useVaultStore.setState({
      artifacts: [{ id: 'career', title: 'Career Decisions' }] as never,
      artifactPathById: { career: '/vault/Career Decisions.md' }
    } as never)
    useThreadStore.setState(useThreadStore.getInitialState())
    useThreadStore.setState({ activeThreadId: 't1', dockTabsByThreadId: { t1: [] } })
  })

  it('renders [[target|alias]] as a clickable link showing the alias', () => {
    render(
      <ThreadMessage
        message={{ role: 'assistant', body: 'See [[Career Decisions|this note]].', sentAt: '' }}
      />
    )
    const link = screen.getByText('this note')
    expect(link.getAttribute('data-wikilink-target')).toBe('Career Decisions')
    expect(screen.queryByText(/\[\[/)).toBeNull()
  })

  it('clicking a resolvable wikilink opens an editor dock tab', () => {
    render(
      <ThreadMessage
        message={{ role: 'assistant', body: 'Open [[Career Decisions]] now.', sentAt: '' }}
      />
    )
    fireEvent.click(screen.getByText('Career Decisions'))
    const tabs = useThreadStore.getState().dockTabsByThreadId['t1']
    expect(tabs).toEqual([{ kind: 'editor', path: '/vault/Career Decisions.md' }])
  })

  it('leaves wikilinks inside inline code untouched', () => {
    render(
      <ThreadMessage message={{ role: 'assistant', body: 'Use `[[raw syntax]]`.', sentAt: '' }} />
    )
    const code = screen.getByText('[[raw syntax]]')
    expect(code.tagName).toBe('CODE')
  })
})
