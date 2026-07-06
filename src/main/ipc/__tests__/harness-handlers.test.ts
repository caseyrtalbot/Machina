// @vitest-environment node
/**
 * Handler-level tests for the harness:* IPC handlers (workstation step 6):
 * root is resolved main-side from WorkspaceService.current() — a null root is
 * a structured error (create) / an empty list (list), never a throw.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>(),
  current: vi.fn<() => { root: string } | null>(() => null),
  createHarness: vi.fn(),
  listHarnesses: vi.fn()
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  })
}))

vi.mock('../../services/workspace-service', () => ({
  getWorkspaceService: vi.fn(() => ({ current: state.current }))
}))

vi.mock('../../services/harness-service', () => ({
  createHarness: state.createHarness,
  listHarnesses: state.listHarnesses
}))

import { registerHarnessIpc } from '../harness'

function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(handler(args as never)) as Promise<T>
}

describe('harness IPC handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    vi.clearAllMocks()
    state.current.mockReturnValue(null)
    registerHarnessIpc()
  })

  it('harness:create returns a structured error when no workspace is open', async () => {
    const result = await invoke('harness:create', { template: 'test-fixer', slug: 'test-fixer' })
    expect(result).toEqual({ ok: false, error: 'no-workspace' })
    expect(state.createHarness).not.toHaveBeenCalled()
  })

  it('harness:list returns an empty list when no workspace is open', async () => {
    expect(await invoke('harness:list', undefined)).toEqual([])
    expect(state.listHarnesses).not.toHaveBeenCalled()
  })

  it('resolves the root main-side and forwards it to the service', async () => {
    state.current.mockReturnValue({ root: '/ws' })
    state.createHarness.mockResolvedValue({ ok: true, root: '/ws/.machina/agents/test-fixer' })
    state.listHarnesses.mockResolvedValue([])

    await invoke('harness:create', { template: 'test-fixer', slug: 'test-fixer' })
    expect(state.createHarness).toHaveBeenCalledWith('/ws', 'test-fixer', 'test-fixer')

    await invoke('harness:list', undefined)
    expect(state.listHarnesses).toHaveBeenCalledWith('/ws')
  })
})
