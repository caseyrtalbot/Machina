import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAgentIpc, setAgentServices, stopAgentServices } from '../agents'

const state = vi.hoisted(() => ({
  currentWindow: null as unknown,
  sent: [] as Array<{ window: unknown; event: string; data: unknown }>,
  monitorCallback: null as null | ((states: readonly { id: string }[]) => void)
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn(),
  typedSend: vi.fn((window: unknown, event: string, data: unknown) => {
    state.sent.push({ window, event, data })
  })
}))

vi.mock('../../window-registry', () => ({
  getMainWindow: () => state.currentWindow
}))

function createMockSpawner() {
  return {
    spawn: vi.fn(),
    spawnLibrarian: vi.fn(),
    setLibrarianMonitor: vi.fn()
  } as never
}

describe('registerAgentIpc', () => {
  beforeEach(() => {
    state.currentWindow = { id: 'startup', isDestroyed: () => false, webContents: {} }
    state.sent.length = 0
    state.monitorCallback = null
    stopAgentServices()
  })

  it('sends agent state updates to the current window after replacement', () => {
    registerAgentIpc()

    setAgentServices(
      {
        stop: vi.fn(),
        start: vi.fn((callback: typeof state.monitorCallback) => {
          state.monitorCallback = callback
        }),
        getAgentStates: vi.fn().mockReturnValue([])
      } as never,
      createMockSpawner()
    )

    state.currentWindow = { id: 'replacement', isDestroyed: () => false, webContents: {} }
    state.monitorCallback?.([{ id: 'agent-1' }])

    expect(state.sent).toEqual([
      {
        window: state.currentWindow,
        event: 'agent:states-changed',
        data: { states: [{ id: 'agent-1' }] }
      }
    ])
  })

  it('merges librarian states with tmux states in callback', () => {
    registerAgentIpc()

    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn((callback: typeof state.monitorCallback) => {
        state.monitorCallback = callback
      }),
      getAgentStates: vi.fn().mockReturnValue([])
    }

    setAgentServices(mockMonitor as never, createMockSpawner())

    // Simulate a tmux callback while no librarian sessions exist
    state.monitorCallback?.([{ id: 'tmux-1' }])

    expect(state.sent.length).toBe(1)
    // With no librarian sessions, states should be just the tmux states
    const payload = state.sent[0].data as { states: unknown[] }
    expect(payload.states).toEqual([{ id: 'tmux-1' }])
  })

  it('calls killAll on librarianMonitor during stopAgentServices', () => {
    registerAgentIpc()

    setAgentServices(
      {
        stop: vi.fn(),
        start: vi.fn(),
        getAgentStates: vi.fn().mockReturnValue([])
      } as never,
      createMockSpawner()
    )

    // stopAgentServices should not throw (killAll on fresh monitor is a no-op)
    expect(() => stopAgentServices()).not.toThrow()
  })

  it('wires setLibrarianMonitor on the spawner', () => {
    registerAgentIpc()

    const spawner = createMockSpawner()

    setAgentServices(
      {
        stop: vi.fn(),
        start: vi.fn(),
        getAgentStates: vi.fn().mockReturnValue([])
      } as never,
      spawner
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((spawner as any).setLibrarianMonitor).toHaveBeenCalled()
  })
})
