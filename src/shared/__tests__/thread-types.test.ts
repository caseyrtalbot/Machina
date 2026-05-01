import { describe, it, expect } from 'vitest'
import type { Thread, ThreadMessage, ToolCall, ToolResult } from '../thread-types'
import { AGENT_IDENTITIES, isAgentIdentity, type AgentIdentity } from '../agent-identity'

describe('thread types', () => {
  it('a Thread has id, agent, model, started, lastMessage, title, dockState, messages', () => {
    const t: Thread = {
      id: '2026-05-01-test',
      agent: 'machina-native',
      model: 'claude-sonnet-4-6',
      started: '2026-05-01T13:00:00Z',
      lastMessage: '2026-05-01T13:05:00Z',
      title: 'Test',
      dockState: { tabs: [] },
      messages: []
    }
    expect(t.id).toBe('2026-05-01-test')
  })

  it('a user ThreadMessage has role:user and a body string', () => {
    const m: ThreadMessage = { role: 'user', body: 'hi', sentAt: '2026-05-01T13:00:00Z' }
    expect(m.role).toBe('user')
  })

  it('an assistant ThreadMessage has role:assistant, body, and toolCalls', () => {
    const tc: ToolCall = { id: 'tc_01', kind: 'read_note', args: { path: 'a.md' } }
    const tr: ToolResult = { id: 'tc_01', ok: true, output: { content: '...', lines: '1-5' } }
    const m: ThreadMessage = {
      role: 'assistant',
      body: 'hello',
      sentAt: '2026-05-01T13:00:00Z',
      toolCalls: [{ call: tc, result: tr }]
    }
    expect(m.role).toBe('assistant')
    if (m.role !== 'assistant') return
    expect(m.toolCalls?.[0].call.kind).toBe('read_note')
  })
})

describe('AgentIdentity', () => {
  it('covers machina-native and the three CLI agents', () => {
    const ids: AgentIdentity[] = ['machina-native', 'cli-claude', 'cli-codex', 'cli-gemini']
    expect(ids).toHaveLength(4)
    expect(AGENT_IDENTITIES).toEqual(ids)
  })

  it('isAgentIdentity narrows correctly', () => {
    expect(isAgentIdentity('machina-native')).toBe(true)
    expect(isAgentIdentity('cli-claude')).toBe(true)
    expect(isAgentIdentity('nope')).toBe(false)
    expect(isAgentIdentity(42)).toBe(false)
    expect(isAgentIdentity(undefined)).toBe(false)
  })
})
