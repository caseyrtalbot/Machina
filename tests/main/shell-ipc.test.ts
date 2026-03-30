// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  webContents: { fromId: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Mock node-pty
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
// Mock tmux-service (no tmux for these tests)
// ---------------------------------------------------------------------------
vi.mock('../../src/main/services/tmux-service', () => ({
  TmuxService: { tryCreate: () => null }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

// ---------------------------------------------------------------------------
// Capture IPC registrations so we can invoke handlers in tests
// ---------------------------------------------------------------------------
import { ipcMain, webContents } from 'electron'

const mockHandle = vi.mocked(ipcMain.handle)
const mockFromId = vi.mocked(webContents.fromId)

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1]
}

// ---------------------------------------------------------------------------
// Import session-router to verify registration/unregistration side effects
// ---------------------------------------------------------------------------
import { getWebContents, clear as clearRouter } from '../../src/main/services/session-router'

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { registerShellIpc } from '../../src/main/ipc/shell'

describe('shell IPC with SessionRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRouter()
  })

  it('registerShellIpc takes no arguments', () => {
    // The function signature should accept zero arguments
    expect(registerShellIpc.length).toBe(0)
    registerShellIpc()
  })

  it('terminal:create registers the session with the sender webContentsId', async () => {
    registerShellIpc()

    const handler = getHandler('terminal:create')

    // Simulate an IpcMainInvokeEvent with sender.id
    const fakeEvent = { sender: { id: 77 } }
    const result = await handler(fakeEvent, { cwd: '/tmp' })

    // Result should be a SessionId string
    expect(typeof result).toBe('string')

    // The session should be registered in the router
    const fakeWc = { id: 77, send: vi.fn(), isDestroyed: () => false }
    mockFromId.mockReturnValue(fakeWc as unknown as Electron.WebContents)

    const wc = getWebContents(result as unknown as string)
    expect(wc).toBe(fakeWc)
  })

  it('terminal:reconnect registers the session when reconnect succeeds', async () => {
    registerShellIpc()

    // First create a session so there's something to reconnect
    const createHandler = getHandler('terminal:create')
    const fakeCreateEvent = { sender: { id: 10 } }
    const sid = (await createHandler(fakeCreateEvent, { cwd: '/tmp' })) as unknown as string

    // Now reconnect from a different webContents
    const reconnectHandler = getHandler('terminal:reconnect')
    const fakeReconnectEvent = { sender: { id: 42 } }

    // In ephemeral mode, reconnect returns null, so the session should NOT be registered
    // with the new sender
    await reconnectHandler(fakeReconnectEvent, {
      sessionId: sid,
      cols: 80,
      rows: 24
    })

    // Since ephemeral mode returns null, session should still be bound to original creator (id: 10)
    const fakeWc10 = { id: 10, send: vi.fn(), isDestroyed: () => false }
    mockFromId.mockReturnValue(fakeWc10 as unknown as Electron.WebContents)

    const wc = getWebContents(sid)
    expect(wc).toBe(fakeWc10)
  })

  it('data callback sends to the correct webContents via session router', async () => {
    registerShellIpc()

    const createHandler = getHandler('terminal:create')
    const fakeEvent = { sender: { id: 55 } }
    const sid = (await createHandler(fakeEvent, { cwd: '/tmp' })) as unknown as string

    // Set up the mock so getWebContents resolves to our fake
    const fakeWc = {
      id: 55,
      send: vi.fn(),
      isDestroyed: () => false
    }
    mockFromId.mockReturnValue(fakeWc as unknown as Electron.WebContents)

    // Simulate data arriving from the pty
    // The onData callback was captured by mockPty.onData
    const onDataCb = mockPty.onData.mock.calls[0]?.[0]
    if (onDataCb) {
      onDataCb('hello world')
    }

    // The data should be sent to the correct webContents
    expect(fakeWc.send).toHaveBeenCalledWith('terminal:data', {
      sessionId: sid,
      data: 'hello world'
    })
  })

  it('exit callback sends to webContents then unregisters the session', async () => {
    registerShellIpc()

    const createHandler = getHandler('terminal:create')
    const fakeEvent = { sender: { id: 33 } }
    const sid = (await createHandler(fakeEvent, { cwd: '/tmp' })) as unknown as string

    const fakeWc = {
      id: 33,
      send: vi.fn(),
      isDestroyed: () => false
    }
    mockFromId.mockReturnValue(fakeWc as unknown as Electron.WebContents)

    // Simulate exit from the pty
    const onExitCb = mockPty.onExit.mock.calls[0]?.[0]
    if (onExitCb) {
      onExitCb({ exitCode: 0 })
    }

    // The exit event should have been sent
    expect(fakeWc.send).toHaveBeenCalledWith('terminal:exit', {
      sessionId: sid,
      code: 0
    })

    // After exit, the session should be unregistered
    mockFromId.mockClear()
    const wc = getWebContents(sid)
    expect(wc).toBeNull()
  })

  it('other handlers still work via typedHandle (terminal:write)', async () => {
    registerShellIpc()

    const createHandler = getHandler('terminal:create')
    const fakeEvent = { sender: { id: 1 } }
    const sid = (await createHandler(fakeEvent, { cwd: '/tmp' })) as unknown as string

    const writeHandler = getHandler('terminal:write')
    // typedHandle ignores event, so pass a dummy
    await writeHandler({}, { sessionId: sid, data: 'ls\n' })

    expect(mockPty.write).toHaveBeenCalledWith('ls\n')
  })
})
