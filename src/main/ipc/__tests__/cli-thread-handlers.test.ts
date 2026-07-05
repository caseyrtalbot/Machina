// @vitest-environment node
/**
 * Handler-level tests for the cli-thread:* IPC handlers (workstation step 1):
 * the per-turn cwd comes from the renderer request — main performs no
 * vault-path config read on this path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>(),
  spawner: {
    spawn: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' }),
    input: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn(),
    cancel: vi.fn().mockReturnValue(true)
  },
  readAppConfigValue: vi.fn()
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  })
}))

vi.mock('../../services/cli-thread-spawner', () => ({
  CliThreadSpawner: class {
    spawn = state.spawner.spawn
    input = state.spawner.input
    close = state.spawner.close
    cancel = state.spawner.cancel
  }
}))

vi.mock('../shell', () => ({
  getShellService: vi.fn(() => ({})),
  getCliAgentThreadBridge: vi.fn(() => ({}))
}))

vi.mock('../config', () => ({
  readAppConfigValue: state.readAppConfigValue
}))

import { registerCliThreadIpc } from '../cli-thread'

function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(handler(args as never)) as Promise<T>
}

describe('cli-thread IPC handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('cli-thread:input forwards the request cwd to the spawner', async () => {
    const result = await invoke<{ ok: boolean }>('cli-thread:input', {
      threadId: 'th_1',
      identity: 'cli-claude',
      text: 'fix the tests',
      cwd: '/repos/project'
    })
    expect(result).toEqual({ ok: true })
    expect(state.spawner.input).toHaveBeenCalledWith(
      'th_1',
      'cli-claude',
      'fix the tests',
      '/repos/project'
    )
  })

  it('cli-thread:input never reads the vault path from app config', async () => {
    await invoke('cli-thread:input', {
      threadId: 'th_1',
      identity: 'cli-claude',
      text: 'hello',
      cwd: '/repos/project'
    })
    expect(state.readAppConfigValue).not.toHaveBeenCalled()
  })

  it('cli-thread:spawn passes cwd through unchanged', async () => {
    await invoke('cli-thread:spawn', {
      threadId: 'th_2',
      identity: 'cli-codex',
      cwd: '/repos/other'
    })
    expect(state.spawner.spawn).toHaveBeenCalledWith('th_2', 'cli-codex', '/repos/other')
  })
})
