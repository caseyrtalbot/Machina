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
  listHarnesses: vi.fn(),
  lintHarnessOnDisk: vi.fn(),
  composeHarnessRun: vi.fn(),
  ensureRootReady: vi.fn(),
  registryGet: vi.fn()
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
  listHarnesses: state.listHarnesses,
  lintHarnessOnDisk: state.lintHarnessOnDisk
}))

vi.mock('../../services/harness-run', () => ({
  composeHarnessRun: state.composeHarnessRun
}))

vi.mock('../../services/harness-run-registry', () => ({
  getHarnessRunRegistry: () => ({
    ensureRootReady: state.ensureRootReady,
    get: state.registryGet
  })
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

    const request = {
      template: 'test-fixer',
      slug: 'custom-fixer',
      overrides: { budgets: { maxTurns: 3, maxWritesPerMinute: 4 } }
    }
    await invoke('harness:create', request)
    expect(state.createHarness).toHaveBeenCalledWith('/ws', request)

    await invoke('harness:list', undefined)
    expect(state.listHarnesses).toHaveBeenCalledWith('/ws')
  })

  it('harness:run runs the backfill first and forwards to composeHarnessRun', async () => {
    state.current.mockReturnValue({ root: '/ws' })
    state.ensureRootReady.mockResolvedValue(undefined)
    state.composeHarnessRun.mockResolvedValue({ ok: true, prompt: 'P', adapter: 'codex' })

    const result = await invoke('harness:run', {
      slug: 'test-fixer',
      threadId: 'th1',
      taskBrief: '  Fix the checkout regression.  '
    })
    expect(result).toEqual({ ok: true, prompt: 'P', adapter: 'codex' })
    expect(state.ensureRootReady).toHaveBeenCalledWith('/ws')
    expect(state.composeHarnessRun).toHaveBeenCalledWith(
      '/ws',
      'test-fixer',
      'th1',
      'Fix the checkout regression.'
    )
  })

  it.each([
    ['absent', {}],
    ['blank', { taskBrief: ' \n\t ' }],
    ['oversized', { taskBrief: 'x'.repeat(4001) }],
    ['NUL', { taskBrief: 'fix\0anything' }]
  ])(
    'harness:run rejects an %s task brief before backfill or composition',
    async (_label, extra) => {
      state.current.mockReturnValue({ root: '/ws' })

      const result = await invoke<{ ok: boolean; error?: string }>('harness:run', {
        slug: 'test-fixer',
        threadId: 'th1',
        ...extra
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('task brief')
      expect(state.ensureRootReady).not.toHaveBeenCalled()
      expect(state.composeHarnessRun).not.toHaveBeenCalled()
    }
  )

  it('harness:run folds a throwing registry into the structured-error contract', async () => {
    state.current.mockReturnValue({ root: '/ws' })
    state.ensureRootReady.mockRejectedValue(new Error('scan exploded'))

    const result = await invoke<{ ok: boolean; error?: string }>('harness:run', {
      slug: 'test-fixer',
      threadId: 'th1',
      taskBrief: 'Fix the checkout regression.'
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('scan exploded')
    expect(state.composeHarnessRun).not.toHaveBeenCalled()
  })

  it('harness:lint returns [] when no workspace is open (same read-op semantics as list)', async () => {
    expect(await invoke('harness:lint', { slug: 'test-fixer' })).toEqual([])
    expect(state.lintHarnessOnDisk).not.toHaveBeenCalled()
  })

  it('harness:lint resolves the root main-side and forwards slug + root to the service', async () => {
    state.current.mockReturnValue({ root: '/ws' })
    const diags = [
      { severity: 'error', code: 'scope-protected-globs', message: 'm', file: 'scope.json' }
    ]
    state.lintHarnessOnDisk.mockResolvedValue(diags)

    expect(await invoke('harness:lint', { slug: 'test-fixer' })).toEqual(diags)
    expect(state.lintHarnessOnDisk).toHaveBeenCalledWith('/ws', 'test-fixer')
  })

  it('harness:binding returns only authoritative adapter capability, and null when the registry throws', async () => {
    state.current.mockReturnValue({ root: '/ws' })
    state.ensureRootReady.mockResolvedValue(undefined)
    state.registryGet.mockReturnValue({
      slug: 'raw-runner',
      workspaceRoot: '/ws',
      adapter: 'raw',
      invocationTemplate: 'private-tool {prompt}'
    })
    expect(await invoke('harness:binding', { threadId: 'th1' })).toEqual({
      slug: 'raw-runner',
      adapter: 'raw',
      rawInvocationReady: true
    })

    state.registryGet.mockReturnValue({
      slug: 'test-fixer',
      workspaceRoot: '/ws',
      adapter: 'claude'
    })
    expect(await invoke('harness:binding', { threadId: 'th1' })).toEqual({
      slug: 'test-fixer',
      adapter: 'claude',
      rawInvocationReady: false
    })

    state.registryGet.mockReturnValue({ slug: 'legacy-runner', workspaceRoot: '/ws' })
    expect(await invoke('harness:binding', { threadId: 'th1' })).toEqual({
      slug: 'legacy-runner',
      adapter: null,
      rawInvocationReady: false
    })

    state.ensureRootReady.mockRejectedValue(new Error('mirror unreadable'))
    expect(await invoke('harness:binding', { threadId: 'th1' })).toBeNull()
  })
})
