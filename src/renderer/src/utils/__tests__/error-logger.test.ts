import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setErrorNotifier, notifyError, logError } from '../error-logger'

describe('error-logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setErrorNotifier(() => {})
    consoleSpy.mockRestore()
  })

  it('notifyError reaches the registered notifier with the user message', () => {
    const notify = vi.fn()
    setErrorNotifier(notify)
    notifyError('canvas-autosave', new Error('disk full'), 'Failed to save canvas')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Failed to save canvas')
  })

  it('notifyError falls back to "context: detail" without a user message', () => {
    const notify = vi.fn()
    setErrorNotifier(notify)
    notifyError('vault-load', new Error('boom'))
    expect(notify).toHaveBeenCalledWith('vault-load: boom')
  })

  it('replacing the notifier routes subsequent notifications to the new one', () => {
    const first = vi.fn()
    const second = vi.fn()
    setErrorNotifier(first)
    setErrorNotifier(second)
    notifyError('ctx', new Error('x'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('logError does not notify', () => {
    const notify = vi.fn()
    setErrorNotifier(notify)
    logError('ctx', new Error('quiet'))
    expect(notify).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
  })
})
