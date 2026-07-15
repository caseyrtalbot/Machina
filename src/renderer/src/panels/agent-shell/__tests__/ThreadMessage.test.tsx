import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThreadMessage, AUTH_ERROR_BODY } from '../ThreadMessage'
import { useVaultStore } from '../../../store/vault-store'
import { useThreadStore } from '../../../store/thread-store'
import { useDockStore } from '../../../store/dock-store'
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

  it('replaces an empty assistant body with a muted note when tool cards exist', () => {
    const { container } = render(
      <ThreadMessage
        message={{
          role: 'assistant',
          body: '',
          sentAt: '',
          toolCalls: [
            {
              call: { id: 'c1', kind: 'cli_command', args: { command: 'gemini -p hi', cwd: '/v' } },
              result: { id: 'c1', ok: true, output: { output: 'raw', exitCode: 0 } }
            }
          ]
        }}
      />
    )
    expect(screen.getByText(/no text reply/i)).toBeTruthy()
    expect(container.querySelector('.thread-prose')).toBeNull()
  })

  it('suppresses the empty prose block without the note when there are no tool calls', () => {
    const { container } = render(
      <ThreadMessage message={{ role: 'assistant', body: '  ', sentAt: '' }} />
    )
    expect(container.querySelector('.thread-prose')).toBeNull()
    expect(screen.queryByText(/no text reply/i)).toBeNull()
  })

  it('shows result-less write_note calls in history as "not run" with no approval buttons', () => {
    render(
      <ThreadMessage
        message={{
          role: 'assistant',
          body: 'started something',
          sentAt: '',
          toolCalls: [
            {
              call: {
                id: 'w1',
                kind: 'write_note',
                args: { path: 'a.md', content: 'hello' }
              }
            }
          ]
        }}
      />
    )
    expect(screen.getByText('not run')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    expect(screen.queryByText('awaiting approval')).toBeNull()
  })

  it('renders legacy result-less CLI trace entries as observed, not pending', () => {
    render(
      <ThreadMessage
        message={{
          role: 'assistant',
          body: '',
          sentAt: '',
          toolCalls: [
            {
              call: {
                id: 'cli_s1_b1_0_error',
                kind: 'cli_codex_error',
                args: { preview: '{"message":"tool call failed"}' }
              }
            }
          ]
        }}
      />
    )

    expect(screen.getByText(/tool: cli_codex_error observed/i)).toBeTruthy()
    expect(screen.queryByText(/tool: cli_codex_error pending/i)).toBeNull()
  })
})

describe('ThreadMessage — wikilinks', () => {
  beforeEach(() => {
    useVaultStore.setState({
      artifacts: [{ id: 'career', title: 'Career Decisions' }] as never,
      artifactPathById: { career: '/vault/Career Decisions.md' }
    } as never)
    useThreadStore.setState(useThreadStore.getInitialState())
    useThreadStore.setState({ activeThreadId: 't1' })
    useDockStore.setState(useDockStore.getInitialState())
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
    const tabs = useDockStore.getState().dockTabsByThreadId['t1']
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
