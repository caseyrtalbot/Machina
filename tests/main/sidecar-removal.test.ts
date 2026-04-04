// @vitest-environment node
/**
 * Tests verifying that sidecar agent infrastructure (librarian/curator)
 * has been cleanly removed. These tests describe the expected state of
 * the codebase after the removal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron for IPC tests
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

// ---------------------------------------------------------------------------
// 1. agents.ts: no librarian monitor references
// ---------------------------------------------------------------------------

describe('agents.ts after sidecar removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('setAgentServices does not require a spawner with setLibrarianMonitor', async () => {
    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')
    registerAgentIpc()

    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn(),
      getAgentStates: vi.fn().mockReturnValue([])
    }

    // Should not throw -- no librarianMonitor creation
    expect(() => setAgentServices(mockMonitor as never, null)).not.toThrow()
  })

  it('agent:get-states returns only pty states (no librarian merge)', async () => {
    const { ipcMain } = await import('electron')
    const mockHandle = vi.mocked(ipcMain.handle)

    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')
    registerAgentIpc()

    const ptyStates = [{ sessionId: 'pty-1', tmuxName: 'te-pty1', status: 'alive' }]
    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn(),
      getAgentStates: vi.fn().mockReturnValue(ptyStates)
    }

    setAgentServices(mockMonitor as never, null)

    const getStatesCall = mockHandle.mock.calls.find(([channel]) => channel === 'agent:get-states')
    const handler = getStatesCall![1]
    const result = await handler({} as never, undefined)

    // Should return ONLY pty states, no librarian states merged in
    expect(result).toEqual(ptyStates)
  })

  it('stopAgentServices works without librarian killAll', async () => {
    const { registerAgentIpc, setAgentServices, stopAgentServices } =
      await import('../../src/main/ipc/agents')
    registerAgentIpc()

    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn(),
      getAgentStates: vi.fn().mockReturnValue([])
    }

    setAgentServices(mockMonitor as never, null)
    expect(() => stopAgentServices()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. agent-spawner.ts: no librarian/curator methods
// ---------------------------------------------------------------------------

describe('AgentSpawner after sidecar removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('does not have spawnLibrarian method', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner({ create: vi.fn() } as never, '/vault')

    expect((spawner as Record<string, unknown>).spawnLibrarian).toBeUndefined()
  })

  it('does not have spawnCurator method', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner({ create: vi.fn() } as never, '/vault')

    expect((spawner as Record<string, unknown>).spawnCurator).toBeUndefined()
  })

  it('does not have setLibrarianMonitor method', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner({ create: vi.fn() } as never, '/vault')

    expect((spawner as Record<string, unknown>).setLibrarianMonitor).toBeUndefined()
  })

  it('retains spawn() method for generic agent spawning', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const mockShell = { create: vi.fn().mockReturnValue('session-id') }
    const spawner = new AgentSpawner(mockShell as never, '/vault')

    expect(typeof spawner.spawn).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 3. librarian-monitor.ts should not exist
// ---------------------------------------------------------------------------

describe('librarian-monitor.ts removal', () => {
  it('cannot be imported (file deleted)', async () => {
    await expect(import('../../src/main/services/librarian-monitor')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4. Agent spawn handler: no librarian/curator dispatch
// ---------------------------------------------------------------------------

describe('agent:spawn handler after sidecar removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('all spawn requests go through generic spawn handler', async () => {
    const { ipcMain } = await import('electron')
    const mockHandle = vi.mocked(ipcMain.handle)

    const { registerAgentIpc, setAgentServices } = await import('../../src/main/ipc/agents')
    registerAgentIpc()

    const mockSpawner = {
      spawn: vi.fn().mockReturnValue('generic-session-id')
    }

    setAgentServices(null, mockSpawner as never)

    const spawnCall = mockHandle.mock.calls.find(([channel]) => channel === 'agent:spawn')
    const handler = spawnCall![1]

    // All requests go through the generic spawn path
    const result = await handler({} as never, {
      cwd: '/vault',
      prompt: 'do something'
    })

    expect(mockSpawner.spawn).toHaveBeenCalledWith({
      cwd: '/vault',
      prompt: 'do something'
    })
    expect(result).toEqual({ sessionId: 'generic-session-id' })
  })
})
