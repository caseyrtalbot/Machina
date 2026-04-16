import { describe, it, expect } from 'vitest'
import { initialStreamState, reduceStream, type StreamState } from '../agent-stream-state'

function apply(events: Parameters<typeof reduceStream>[1][]): StreamState {
  return events.reduce<StreamState>((state, ev) => reduceStream(state, ev), initialStreamState())
}

describe('reduceStream', () => {
  it('starts in starting phase with empty buffers', () => {
    const s = initialStreamState()
    expect(s.phase).toBe('starting')
    expect(s.thinking).toBe('')
    expect(s.visibleText).toBe('')
    expect(s.opCount).toBeNull()
  })

  it('advances phase on phase events', () => {
    const s = apply([
      { kind: 'phase', phase: 'thinking' },
      { kind: 'phase', phase: 'drafting' }
    ])
    expect(s.phase).toBe('drafting')
  })

  it('records op count on materializing phase', () => {
    const s = apply([{ kind: 'phase', phase: 'materializing', count: 7 }])
    expect(s.phase).toBe('materializing')
    expect(s.opCount).toBe(7)
  })

  it('appends thinking deltas', () => {
    const s = apply([
      { kind: 'phase', phase: 'thinking' },
      { kind: 'thinking-delta', text: 'I am ' },
      { kind: 'thinking-delta', text: 'reasoning.' }
    ])
    expect(s.thinking).toBe('I am reasoning.')
  })

  it('appends text deltas to visible buffer', () => {
    const s = apply([
      { kind: 'phase', phase: 'drafting' },
      { kind: 'text-delta', text: 'Here we go. ' },
      { kind: 'text-delta', text: 'Thinking out loud.' }
    ])
    expect(s.visibleText).toBe('Here we go. Thinking out loud.')
  })

  it('hides JSON fence when it arrives in a single delta', () => {
    const s = apply([
      { kind: 'phase', phase: 'drafting' },
      { kind: 'text-delta', text: 'Plan:\n' },
      { kind: 'text-delta', text: '```json\n{"ops": []}\n```\n' }
    ])
    expect(s.visibleText).toBe('Plan:\n')
  })

  it('hides JSON fence when split across deltas', () => {
    const s = apply([
      { kind: 'phase', phase: 'drafting' },
      { kind: 'text-delta', text: 'Thinking.\n``' },
      { kind: 'text-delta', text: '`json\n' },
      { kind: 'text-delta', text: '{"ops":[]}' }
    ])
    expect(s.visibleText).toBe('Thinking.\n')
  })

  it('hides bare ``` fence followed by json object', () => {
    const s = apply([
      { kind: 'phase', phase: 'drafting' },
      { kind: 'text-delta', text: 'Here:\n```\n{"ops":[]}' }
    ])
    expect(s.visibleText).toBe('Here:\n')
  })

  it('does not hide a stray backtick that never matures into a fence', () => {
    const s = apply([
      { kind: 'phase', phase: 'drafting' },
      { kind: 'text-delta', text: 'The `foo` symbol is relevant.' }
    ])
    expect(s.visibleText).toBe('The `foo` symbol is relevant.')
  })

  it('reset returns a fresh state', () => {
    const after = apply([
      { kind: 'phase', phase: 'thinking' },
      { kind: 'thinking-delta', text: 'x' }
    ])
    const fresh = initialStreamState()
    expect(fresh.phase).toBe('starting')
    expect(fresh.thinking).toBe('')
    expect(after.thinking).toBe('x')
  })
})
