import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentSidecarState } from '../../src/shared/agent-types'

// Mock electron before any imports that use it
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

import { ipcMain } from 'electron'

const mockIpcHandle = vi.mocked(ipcMain.handle)

describe('registerAgentIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('registers handlers for agent:get-states and agent:spawn', async () => {
    const { registerAgentIpc } = await import('../../src/main/ipc/agents')

    registerAgentIpc()

    expect(mockIpcHandle).toHaveBeenCalledWith('agent:get-states', expect.any(Function))
    expect(mockIpcHandle).toHaveBeenCalledWith('agent:spawn', expect.any(Function))
  })

  it('agent:get-states returns empty array when no services set', async () => {
    const { registerAgentIpc } = await import('../../src/main/ipc/agents')

    registerAgentIpc()

    const getStatesCall = mockIpcHandle.mock.calls.find(
      ([channel]) => channel === 'agent:get-states'
    )
    const handler = getStatesCall![1]
    const result = await handler({} as never, undefined)

    expect(result).toEqual([])
  })

  it('agent:get-states delegates to monitor after setAgentServices', async () => {
    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')

    const fakeStates: AgentSidecarState[] = [
      {
        sessionId: 'abc123',
        tmuxName: 'te-abc123',
        status: 'alive',
        pid: 12345,
        currentCommand: 'claude'
      }
    ]
    const mockMonitor = {
      getAgentStates: vi.fn().mockReturnValue(fakeStates),
      start: vi.fn(),
      stop: vi.fn()
    } as unknown as import('../../src/main/services/pty-monitor').PtyMonitor

    registerAgentIpc()
    setAgentServices(mockMonitor, null)

    const getStatesCall = mockIpcHandle.mock.calls.find(
      ([channel]) => channel === 'agent:get-states'
    )
    const handler = getStatesCall![1]
    const result = await handler({} as never, undefined)

    expect(mockMonitor.getAgentStates).toHaveBeenCalledOnce()
    expect(result).toEqual(fakeStates)
  })

  it('setAgentServices starts monitor with onChange callback', async () => {
    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')

    const mockMonitor = {
      getAgentStates: vi.fn().mockReturnValue([]),
      start: vi.fn(),
      stop: vi.fn()
    } as unknown as import('../../src/main/services/pty-monitor').PtyMonitor

    registerAgentIpc()
    setAgentServices(mockMonitor, null)

    expect(mockMonitor.start).toHaveBeenCalledOnce()
    expect(mockMonitor.start).toHaveBeenCalledWith(expect.any(Function))
  })

  it('setAgentServices stops previous monitor on vault switch', async () => {
    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')

    const monitor1 = { getAgentStates: vi.fn().mockReturnValue([]), start: vi.fn(), stop: vi.fn() }
    const monitor2 = { getAgentStates: vi.fn().mockReturnValue([]), start: vi.fn(), stop: vi.fn() }

    registerAgentIpc()
    setAgentServices(monitor1 as never, null)
    setAgentServices(monitor2 as never, null)

    expect(monitor1.stop).toHaveBeenCalledOnce()
    expect(monitor2.start).toHaveBeenCalledOnce()
  })

  it('agent:spawn calls spawner and returns sessionId', async () => {
    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')

    const mockSpawner = {
      spawn: vi.fn().mockReturnValue('spawned-session-123')
    } as unknown as import('../../src/main/services/agent-spawner').AgentSpawner

    registerAgentIpc()
    setAgentServices(null, mockSpawner)

    const spawnCall = mockIpcHandle.mock.calls.find(([channel]) => channel === 'agent:spawn')
    const handler = spawnCall![1]
    const result = await handler({} as never, { cwd: '/test/dir', prompt: 'do stuff' })

    expect(mockSpawner.spawn).toHaveBeenCalledWith({ cwd: '/test/dir', prompt: 'do stuff' })
    expect(result).toEqual({ sessionId: 'spawned-session-123' })
  })

  it('agent:spawn returns error when no spawner set', async () => {
    const { registerAgentIpc } = await import('../../src/main/ipc/agents')

    registerAgentIpc()

    const spawnCall = mockIpcHandle.mock.calls.find(([channel]) => channel === 'agent:spawn')
    const handler = spawnCall![1]
    const result = await handler({} as never, { cwd: '/test/dir' })

    expect(result).toEqual({ error: 'Agent spawner not available' })
  })
})
