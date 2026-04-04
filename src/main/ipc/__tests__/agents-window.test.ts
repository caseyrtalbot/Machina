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
    spawn: vi.fn()
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

  it('sends pty monitor states directly (no librarian merge)', () => {
    registerAgentIpc()

    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn((callback: typeof state.monitorCallback) => {
        state.monitorCallback = callback
      }),
      getAgentStates: vi.fn().mockReturnValue([])
    }

    setAgentServices(mockMonitor as never, createMockSpawner())

    // Simulate a pty monitor callback
    state.monitorCallback?.([{ id: 'pty-1' }])

    expect(state.sent.length).toBe(1)
    const payload = state.sent[0].data as { states: unknown[] }
    expect(payload.states).toEqual([{ id: 'pty-1' }])
  })

  it('stopAgentServices does not throw', () => {
    registerAgentIpc()

    setAgentServices(
      {
        stop: vi.fn(),
        start: vi.fn(),
        getAgentStates: vi.fn().mockReturnValue([])
      } as never,
      createMockSpawner()
    )

    expect(() => stopAgentServices()).not.toThrow()
  })
})
