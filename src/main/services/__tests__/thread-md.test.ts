import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { encodeThread, decodeThread } from '../thread-md'
import type { Thread } from '../../../shared/thread-types'

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'a',
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T00:00:00Z',
  lastMessage: '2026-05-01T00:00:00Z',
  title: 'Sample',
  dockState: { tabs: [] },
  autoAcceptSession: false,
  messages: [],
  ...overrides
})

describe('thread-md auto-accept persistence', () => {
  it('does not write auto_accept_session to frontmatter when toggled on', () => {
    const md = encodeThread(baseThread({ autoAcceptSession: true }))
    const { data } = matter(md)
    expect(data.auto_accept_session).toBeUndefined()
  })

  it('always decodes autoAcceptSession to false, even if stale frontmatter says true', () => {
    const md = matter.stringify('', {
      agent: 'machina-native',
      model: 'claude-sonnet-4-6',
      started: '2026-05-01T00:00:00Z',
      last_message: '2026-05-01T00:00:00Z',
      title: 'Sample',
      dock_state: { tabs: [] },
      auto_accept_session: true
    })
    const t = decodeThread(md)
    expect(t.autoAcceptSession).toBe(false)
  })

  it('strips stale auto_accept_session frontmatter on round-trip', () => {
    const md = matter.stringify('', {
      agent: 'machina-native',
      model: 'claude-sonnet-4-6',
      started: '2026-05-01T00:00:00Z',
      last_message: '2026-05-01T00:00:00Z',
      title: 'Sample',
      dock_state: { tabs: [] },
      auto_accept_session: true
    })
    const decoded = decodeThread(md)
    const reencoded = encodeThread(decoded)
    expect(matter(reencoded).data.auto_accept_session).toBeUndefined()
  })
})
