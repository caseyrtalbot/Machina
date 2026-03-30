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
  process: 'zsh'
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty)
}))

// ---------------------------------------------------------------------------
// Mock TmuxService to test both paths of the facade
// ---------------------------------------------------------------------------
const mockTmuxService = {
  setCallbacks: vi.fn(),
  create: vi.fn(),
  reconnect: vi.fn(),
  discover: vi.fn(() => []),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  detachAll: vi.fn(),
  killAll: vi.fn(),
  getProcessName: vi.fn(() => 'zsh')
}

let tmuxAvailable = false

vi.mock('../../src/main/services/tmux-service', () => ({
  TmuxService: {
    tryCreate: () => (tmuxAvailable ? mockTmuxService : null)
  }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { ShellService } from '../../src/main/services/shell-service'
import { sessionId } from '@shared/types'

describe('ShellService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tmuxAvailable = false
  })

  // -----------------------------------------------------------------------
  // Ephemeral path (no tmux)
  // -----------------------------------------------------------------------

  describe('ephemeral mode (no tmux)', () => {
    it('tmuxAvailable is false', () => {
      const service = new ShellService()
      expect(service.tmuxAvailable).toBe(false)
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

    it('reconnect returns null without tmux', () => {
      const service = new ShellService()
      const result = service.reconnect(sessionId('test'), 80, 24)
      expect(result).toBeNull()
    })

    it('discover returns empty array without tmux', () => {
      const service = new ShellService()
      expect(service.discover()).toEqual([])
    })

    it('write delegates to ephemeral pty', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      const id = service.create('/tmp')
      service.write(id, 'test')
      expect(mockPty.write).toHaveBeenCalledWith('test')
    })

    it('resize delegates to ephemeral pty', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      const id = service.create('/tmp')
      service.resize(id, 120, 40)
      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('kill delegates to ephemeral pty', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      const id = service.create('/tmp')
      service.kill(id)
      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('getProcessName returns process name from ephemeral pty', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      const id = service.create('/tmp')
      expect(service.getProcessName(id)).toBe('zsh')
    })

    it('shutdown kills ephemeral sessions', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      service.create('/tmp')
      service.shutdown()
      expect(mockPty.kill).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Tmux path
  // -----------------------------------------------------------------------

  describe('tmux mode', () => {
    beforeEach(() => {
      tmuxAvailable = true
    })

    it('tmuxAvailable is true', () => {
      const service = new ShellService()
      expect(service.tmuxAvailable).toBe(true)
    })

    it('create delegates to TmuxService', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      const id = service.create('/tmp', undefined, undefined, undefined, 'Shell 1', '/vault')
      expect(mockTmuxService.create).toHaveBeenCalledWith(
        id,
        '/tmp',
        undefined,
        undefined,
        undefined,
        'Shell 1',
        '/vault'
      )
    })

    it('reconnect delegates to TmuxService', () => {
      const expected = { scrollback: 'hello', meta: { shell: '/bin/zsh', cwd: '/tmp' } }
      mockTmuxService.reconnect.mockReturnValue(expected)

      const service = new ShellService()
      const result = service.reconnect(sessionId('test'), 80, 24)
      expect(result).toEqual(expected)
      expect(mockTmuxService.reconnect).toHaveBeenCalledWith('test', 80, 24)
    })

    it('discover delegates to TmuxService', () => {
      const sessions = [
        { sessionId: 'abc', meta: { shell: '/bin/zsh', cwd: '/tmp', createdAt: '' } }
      ]
      mockTmuxService.discover.mockReturnValue(sessions)

      const service = new ShellService()
      expect(service.discover()).toEqual(sessions)
    })

    it('write delegates to TmuxService', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      service.write(sessionId('test'), 'hello')
      expect(mockTmuxService.write).toHaveBeenCalledWith('test', 'hello')
    })

    it('resize delegates to TmuxService', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      service.resize(sessionId('test'), 120, 40)
      expect(mockTmuxService.resize).toHaveBeenCalledWith('test', 120, 40)
    })

    it('kill delegates to TmuxService', () => {
      const service = new ShellService()
      service.setCallbacks(
        () => {},
        () => {}
      )
      service.kill(sessionId('test'))
      expect(mockTmuxService.kill).toHaveBeenCalledWith('test')
    })

    it('getProcessName delegates to TmuxService', () => {
      const service = new ShellService()
      expect(service.getProcessName(sessionId('test'))).toBe('zsh')
      expect(mockTmuxService.getProcessName).toHaveBeenCalledWith('test')
    })

    it('shutdown detaches tmux sessions instead of killing', () => {
      const service = new ShellService()
      service.shutdown()
      expect(mockTmuxService.detachAll).toHaveBeenCalled()
      expect(mockTmuxService.killAll).not.toHaveBeenCalled()
    })

    it('killAll kills both tmux and ephemeral', () => {
      const service = new ShellService()
      service.killAll()
      expect(mockTmuxService.killAll).toHaveBeenCalled()
    })
  })
})
