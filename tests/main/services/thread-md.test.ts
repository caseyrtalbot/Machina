// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { encodeThread, decodeThread } from '../../../src/main/services/thread-md'
import type { Thread } from '../../../src/shared/thread-types'

const sample = (): Thread => ({
  id: '2026-05-01-test',
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T13:00:00Z',
  lastMessage: '2026-05-01T13:05:00Z',
  title: 'Test thread',
  dockState: { tabs: [{ kind: 'canvas', id: 'block-protocol' }] },
  messages: [
    { role: 'user', body: 'Add a te-error verb.', sentAt: '2026-05-01T13:00:00Z' },
    {
      role: 'assistant',
      body: 'Reading the spec.',
      sentAt: '2026-05-01T13:01:00Z',
      toolCalls: [
        {
          call: { id: 'tc_01', kind: 'read_note', args: { path: 'docs/x.md' } },
          result: { id: 'tc_01', ok: true, output: { lines: '1-10' } }
        }
      ]
    }
  ]
})

describe('thread-md encode/decode', () => {
  it('roundtrips a thread without losing message structure', () => {
    const t = sample()
    const md = encodeThread(t)
    const back = decodeThread(md)
    // id is set by caller from filename, not encoded; clear before compare
    expect(back.agent).toBe(t.agent)
    expect(back.model).toBe(t.model)
    expect(back.started).toBe(t.started)
    expect(back.lastMessage).toBe(t.lastMessage)
    expect(back.title).toBe(t.title)
    expect(back.dockState).toEqual(t.dockState)
    expect(back.messages).toHaveLength(t.messages.length)
    expect(back.messages[0].role).toBe('user')
    expect(back.messages[1].role).toBe('assistant')
    const a = back.messages[1]
    if (a.role !== 'assistant') return
    expect(a.toolCalls?.[0].call.kind).toBe('read_note')
    expect(a.toolCalls?.[0].result?.ok).toBe(true)
  })

  it('encodes user role under "## User"', () => {
    const md = encodeThread(sample())
    expect(md).toMatch(/\n## User\n/)
    expect(md).toMatch(/\n## Machina\n/)
  })

  it('encodes tool call as fenced machina-tool-call block', () => {
    const md = encodeThread(sample())
    expect(md).toMatch(/```machina-tool-call/)
    expect(md).toMatch(/```machina-tool-result/)
  })

  it('decodes legacy thread without dock_state by defaulting tabs to []', () => {
    const md = `---\nagent: machina-native\nmodel: claude-sonnet-4-6\nstarted: 2026-05-01T13:00:00Z\nlast_message: 2026-05-01T13:00:00Z\ntitle: Old\n---\n\n## User\n\nhi\n`
    const t = decodeThread(md)
    expect(t.dockState).toEqual({ tabs: [] })
  })

  it('a thread with no messages encodes and decodes empty', () => {
    const empty: Thread = { ...sample(), messages: [] }
    expect(decodeThread(encodeThread(empty)).messages).toEqual([])
  })

  it('roundtrips dock_state covering all DockTab kinds', () => {
    const t: Thread = {
      ...sample(),
      dockState: {
        tabs: [
          { kind: 'canvas', id: 'block-protocol' },
          { kind: 'editor', path: 'docs/x.md' },
          { kind: 'terminal', sessionId: 'sess-7' },
          { kind: 'graph' },
          { kind: 'ghosts' },
          { kind: 'health' }
        ]
      }
    }
    const back = decodeThread(encodeThread(t))
    expect(back.dockState.tabs).toEqual(t.dockState.tabs)
  })

  it('a tool call without a result roundtrips with no result', () => {
    const oneCall: Thread = {
      ...sample(),
      messages: [
        {
          role: 'assistant',
          body: 'thinking...',
          sentAt: '',
          toolCalls: [{ call: { id: 'tc_01', kind: 'list_vault', args: { globs: ['*.md'] } } }]
        }
      ]
    }
    const back = decodeThread(encodeThread(oneCall))
    const m = back.messages[0]
    expect(m.role).toBe('assistant')
    if (m.role !== 'assistant') return
    expect(m.toolCalls?.[0].result).toBeUndefined()
  })
})
