import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock node-pty (native module not available in vitest)
// ---------------------------------------------------------------------------
const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345,
  process: 'zsh'
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty)
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFileSync: vi.fn(() => 'zsh\n') }
})

vi.mock('../../src/main/services/session-paths', () => ({
  getTerminfoDir: vi.fn(() => undefined),
  writeSessionMeta: vi.fn(),
  readSessionMeta: vi.fn(() => null),
  deleteSessionMeta: vi.fn(),
  ensureSessionDir: vi.fn(),
  getSessionDir: vi.fn(() => '/tmp/test-sessions')
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readdirSync: vi.fn(() => []) }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { ShellService } from '../../src/main/services/shell-service'
import { sessionId } from '@shared/types'

describe('ShellService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('create returns a branded SessionId', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    const id = service.create('/tmp')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('write delegates to PtyService', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    const id = service.create('/tmp')
    service.write(id, 'test')
    expect(mockPty.write).toHaveBeenCalledWith('test')
  })

  it('sendRawKeys delegates to pty.write (no special tmux path)', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    const id = service.create('/tmp')
    service.sendRawKeys(id, '\x1b[13;2u')
    expect(mockPty.write).toHaveBeenCalledWith('\x1b[13;2u')
  })

  it('resize delegates to PtyService', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    const id = service.create('/tmp')
    service.resize(id, 120, 40)
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })

  it('kill delegates to PtyService', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    const id = service.create('/tmp')
    service.kill(id)
    expect(mockPty.kill).toHaveBeenCalled()
  })

  it('reconnect returns null for unknown session', () => {
    const service = new ShellService()
    const result = service.reconnect(sessionId('nonexistent'), 80, 24)
    expect(result).toBeNull()
  })

  it('discover returns empty when all sessions are connected', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    service.create('/tmp')
    expect(service.discover()).toEqual([])
  })

  it('exposes PtyService for monitoring', () => {
    const service = new ShellService()
    expect(service.getPtyService()).toBeDefined()
  })

  it('shutdown kills active PTYs', async () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    service.create('/tmp')
    await service.shutdown()
    expect(mockPty.kill).toHaveBeenCalled()
  })

  it('killAll kills all sessions', () => {
    const service = new ShellService()
    service.setCallbacks(
      () => {},
      () => {}
    )
    service.create('/tmp')
    service.killAll()
    expect(mockPty.kill).toHaveBeenCalled()
  })
})
