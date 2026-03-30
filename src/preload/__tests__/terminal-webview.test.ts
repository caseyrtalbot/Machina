// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockInvoke, mockOn, mockSendToHost, captured } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = { exposeCallback: undefined as any }
  return {
    mockInvoke: vi.fn(),
    mockOn: vi.fn(),
    mockSendToHost: vi.fn(),
    captured: state
  }
})

vi.mock('electron', () => ({
  ipcRenderer: { invoke: mockInvoke, on: mockOn, sendToHost: mockSendToHost },
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
      captured.exposeCallback = api
    })
  }
}))

// Import triggers module-level side effects (contextBridge.exposeInMainWorld call)
import '../terminal-webview'

// Capture the ipcRenderer.on handlers registered at module load time,
// before any test's beforeEach can clear the mock call history.
function findHandler(channel: string) {
  const call = mockOn.mock.calls.find((c: unknown[]) => c[0] === channel)
  return call?.[1]
}

const dataHandler = findHandler('terminal:data')
const exitHandler = findHandler('terminal:exit')

// Count registrations before any clearing
const dataRegistrationCount = mockOn.mock.calls.filter(
  (c: unknown[]) => c[0] === 'terminal:data'
).length
const exitRegistrationCount = mockOn.mock.calls.filter(
  (c: unknown[]) => c[0] === 'terminal:exit'
).length

describe('terminal-webview preload', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
    mockSendToHost.mockClear()
  })

  describe('onData / offData listener set', () => {
    it('dispatches terminal:data to all registered listeners', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      captured.exposeCallback.onData(cb1)
      captured.exposeCallback.onData(cb2)

      expect(dataHandler).toBeDefined()
      const payload = { sessionId: 'sess-1', data: 'hello' }
      dataHandler({} /* event */, payload)

      expect(cb1).toHaveBeenCalledWith(payload)
      expect(cb2).toHaveBeenCalledWith(payload)

      // Clean up
      captured.exposeCallback.offData(cb1)
      captured.exposeCallback.offData(cb2)
    })

    it('offData removes only the specified listener', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      captured.exposeCallback.onData(cb1)
      captured.exposeCallback.onData(cb2)
      captured.exposeCallback.offData(cb1)

      const payload = { sessionId: 'sess-2', data: 'world' }
      dataHandler({}, payload)

      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalledWith(payload)

      // Clean up
      captured.exposeCallback.offData(cb2)
    })
  })

  describe('onExit / offExit listener set', () => {
    it('dispatches terminal:exit to all registered listeners', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      captured.exposeCallback.onExit(cb1)
      captured.exposeCallback.onExit(cb2)

      expect(exitHandler).toBeDefined()
      const payload = { sessionId: 'sess-3', code: 0 }
      exitHandler({}, payload)

      expect(cb1).toHaveBeenCalledWith(payload)
      expect(cb2).toHaveBeenCalledWith(payload)

      // Clean up
      captured.exposeCallback.offExit(cb1)
      captured.exposeCallback.offExit(cb2)
    })

    it('offExit removes only the specified listener', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      captured.exposeCallback.onExit(cb1)
      captured.exposeCallback.onExit(cb2)
      captured.exposeCallback.offExit(cb1)

      const payload = { sessionId: 'sess-4', code: 1 }
      exitHandler({}, payload)

      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalledWith(payload)

      // Clean up
      captured.exposeCallback.offExit(cb2)
    })
  })

  describe('single ipcRenderer.on registration per channel', () => {
    it('registers exactly one listener for terminal:data', () => {
      expect(dataRegistrationCount).toBe(1)
    })

    it('registers exactly one listener for terminal:exit', () => {
      expect(exitRegistrationCount).toBe(1)
    })
  })

  describe('sendToHost', () => {
    it('delegates to ipcRenderer.sendToHost', () => {
      captured.exposeCallback.sendToHost('some-channel', 'arg1', 42)
      expect(mockSendToHost).toHaveBeenCalledWith('some-channel', 'arg1', 42)
    })
  })

  describe('IPC invoke methods', () => {
    it('create calls ipcRenderer.invoke with terminal:create', () => {
      const args = { cwd: '/tmp', shell: '/bin/zsh', label: 'test', vaultPath: '/vault' }
      captured.exposeCallback.create(args)
      expect(mockInvoke).toHaveBeenCalledWith('terminal:create', args)
    })

    it('write calls ipcRenderer.invoke with terminal:write', () => {
      const args = { sessionId: 'sess-1', data: 'ls\n' }
      captured.exposeCallback.write(args)
      expect(mockInvoke).toHaveBeenCalledWith('terminal:write', args)
    })

    it('resize calls ipcRenderer.invoke with terminal:resize', () => {
      const args = { sessionId: 'sess-1', cols: 80, rows: 24 }
      captured.exposeCallback.resize(args)
      expect(mockInvoke).toHaveBeenCalledWith('terminal:resize', args)
    })

    it('kill calls ipcRenderer.invoke with terminal:kill', () => {
      const args = { sessionId: 'sess-1' }
      captured.exposeCallback.kill(args)
      expect(mockInvoke).toHaveBeenCalledWith('terminal:kill', args)
    })

    it('reconnect calls ipcRenderer.invoke with terminal:reconnect', () => {
      const args = { sessionId: 'sess-1', cols: 120, rows: 40 }
      captured.exposeCallback.reconnect(args)
      expect(mockInvoke).toHaveBeenCalledWith('terminal:reconnect', args)
    })
  })
})
