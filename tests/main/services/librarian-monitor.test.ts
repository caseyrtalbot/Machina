// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LibrarianMonitor } from '../../../src/main/services/librarian-monitor'

describe('LibrarianMonitor', () => {
  let monitor: LibrarianMonitor

  beforeEach(() => {
    monitor = new LibrarianMonitor()
  })

  it('returns empty states initially', () => {
    expect(monitor.getStates()).toEqual([])
  })

  it('tracks a registered session as alive', () => {
    monitor.register('session-1', 12345, '/vault/path')
    const states = monitor.getStates()
    expect(states).toHaveLength(1)
    expect(states[0].sessionId).toBe('session-1')
    expect(states[0].status).toBe('alive')
    expect(states[0].pid).toBe(12345)
    expect(states[0].cwd).toBe('/vault/path')
    expect(states[0].label).toBe('librarian')
  })

  it('marks session as exited on complete', () => {
    monitor.register('session-1', 12345, '/vault/path')
    monitor.complete('session-1', 0)
    const states = monitor.getStates()
    expect(states[0].status).toBe('exited')
  })

  it('removes session on cleanup', () => {
    monitor.register('session-1', 12345, '/vault/path')
    monitor.complete('session-1', 0)
    monitor.cleanup('session-1')
    expect(monitor.getStates()).toEqual([])
  })

  it('calls onChange when state changes', () => {
    const onChange = vi.fn()
    monitor.setOnChange(onChange)
    monitor.register('session-1', 12345, '/vault/path')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0][0].sessionId).toBe('session-1')
  })

  it('kills a running session', () => {
    const killFn = vi.fn()
    monitor.register('session-1', 12345, '/vault/path', killFn)
    monitor.kill('session-1')
    expect(killFn).toHaveBeenCalledOnce()
  })
})
