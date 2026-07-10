// @vitest-environment node
/**
 * Handler-level tests for the cli-thread:* IPC handlers (workstation step 1):
 * the per-turn cwd comes from the renderer request — main performs no
 * vault-path config read on this path — and the model-flag trust rule lives
 * here at the IPC boundary (Phase 2 step 1): only an explicit pick that is in
 * the adapter's roster AND passes the charset check is forwarded; anything
 * else forwards undefined, with an audit note for explicit-but-rejected picks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import type { AuditEntry } from '@shared/agent-types'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>(),
  spawner: {
    spawn: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' }),
    input: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn(),
    cancel: vi.fn().mockReturnValue(true),
    getSessionId: vi.fn().mockReturnValue(undefined),
    hasLiveSession: vi.fn().mockReturnValue(false)
  },
  readAppConfigValue: vi.fn(),
  registry: {
    ensureRootReady: vi.fn(async () => {}),
    get: vi.fn(() => undefined)
  },
  auditEntries: [] as unknown[]
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  })
}))

vi.mock('../../services/cli-thread-spawner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/cli-thread-spawner')>()
  return {
    ...actual,
    CliThreadSpawner: class {
      spawn = state.spawner.spawn
      input = state.spawner.input
      close = state.spawner.close
      cancel = state.spawner.cancel
      getSessionId = state.spawner.getSessionId
      hasLiveSession = state.spawner.hasLiveSession
    }
  }
})

vi.mock('../../services/audit-logger', () => ({
  AuditLogger: class {
    log(entry: unknown): void {
      state.auditEntries.push(entry)
    }
  }
}))

vi.mock('../../services/harness-run-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/harness-run-registry')>()
  return { ...actual, getHarnessRunRegistry: () => state.registry }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/nonexistent-test-userdata') }
}))

vi.mock('../shell', () => ({
  getShellService: vi.fn(() => ({})),
  getCliAgentThreadBridge: vi.fn(() => ({}))
}))

vi.mock('../config', () => ({
  readAppConfigValue: state.readAppConfigValue
}))

import { checkMaxTurnsOnTurnStarted, registerCliThreadIpc } from '../cli-thread'

function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(handler(args as never)) as Promise<T>
}

describe('cli-thread IPC handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
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
      '/repos/project',
      undefined,
      undefined,
      false
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
    expect(state.spawner.spawn).toHaveBeenCalledWith(
      'th_2',
      'cli-codex',
      '/repos/other',
      undefined,
      undefined,
      false
    )
  })
})

describe('cli-thread model trust rule (workstation Phase 2 step 1)', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('forwards an explicit roster model on spawn (claude alias)', async () => {
    await invoke('cli-thread:spawn', {
      threadId: 'th_1',
      identity: 'cli-claude',
      cwd: '/v',
      model: 'sonnet'
    })
    expect(state.spawner.spawn).toHaveBeenCalledWith(
      'th_1',
      'cli-claude',
      '/v',
      undefined,
      'sonnet',
      false
    )
    expect(state.auditEntries).toEqual([])
  })

  it('forwards an explicit roster model on input (codex)', async () => {
    await invoke('cli-thread:input', {
      threadId: 'th_1',
      identity: 'cli-codex',
      text: 'go',
      cwd: '/v',
      model: 'gpt-5.5'
    })
    expect(state.spawner.input).toHaveBeenCalledWith(
      'th_1',
      'cli-codex',
      'go',
      '/v',
      undefined,
      'gpt-5.5',
      false
    )
    expect(state.auditEntries).toEqual([])
  })

  it('maps the persisted DEFAULT_NATIVE_MODEL filler to undefined with NO audit note', async () => {
    // Every pre-step-1 CLI thread carries the filler; it is not an explicit
    // pick, so no flag and no audit noise (set-to-filler regression).
    await invoke('cli-thread:input', {
      threadId: 'th_1',
      identity: 'cli-codex',
      text: 'go',
      cwd: '/v',
      model: DEFAULT_NATIVE_MODEL
    })
    expect(state.spawner.input).toHaveBeenCalledWith(
      'th_1',
      'cli-codex',
      'go',
      '/v',
      undefined,
      undefined,
      false
    )
    expect(state.auditEntries).toEqual([])
  })

  it('rejects a cross-adapter model (claude model on codex): undefined + audit note', async () => {
    await invoke('cli-thread:input', {
      threadId: 'th_1',
      identity: 'cli-codex',
      text: 'go',
      cwd: '/v',
      model: 'sonnet'
    })
    expect(state.spawner.input).toHaveBeenCalledWith(
      'th_1',
      'cli-codex',
      'go',
      '/v',
      undefined,
      undefined,
      false
    )
    expect(state.auditEntries).toHaveLength(1)
    const entry = state.auditEntries[0] as AuditEntry
    expect(entry.tool).toBe('cli-thread:input')
    expect(entry.decision).toBe('denied')
    expect(entry.args).toMatchObject({ identity: 'cli-codex', requestedModel: 'sonnet' })
  })

  it('rejects an off-roster model on spawn: undefined + audit note', async () => {
    await invoke('cli-thread:spawn', {
      threadId: 'th_1',
      identity: 'cli-claude',
      cwd: '/v',
      model: 'gpt-5.5-codex'
    })
    expect(state.spawner.spawn).toHaveBeenCalledWith(
      'th_1',
      'cli-claude',
      '/v',
      undefined,
      undefined,
      false
    )
    expect(state.auditEntries).toHaveLength(1)
    expect((state.auditEntries[0] as AuditEntry).tool).toBe('cli-thread:spawn')
  })

  it('gemini ships an empty roster: any pick resolves to undefined + audit note', async () => {
    await invoke('cli-thread:spawn', {
      threadId: 'th_1',
      identity: 'cli-gemini',
      cwd: '/v',
      model: 'gemini-2.5-pro'
    })
    expect(state.spawner.spawn).toHaveBeenCalledWith(
      'th_1',
      'cli-gemini',
      '/v',
      undefined,
      undefined,
      false
    )
    expect(state.auditEntries).toHaveLength(1)
  })
})

describe('cli-thread:get-session (workstation Phase 2 step 4)', () => {
  beforeEach(() => {
    state.handlers.clear()
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('round-trips the spawner binding with PTY liveness', async () => {
    state.spawner.getSessionId.mockReturnValue('sess-live')
    state.spawner.hasLiveSession.mockReturnValue(true)
    const result = await invoke('cli-thread:get-session', { threadId: 'th_1' })
    expect(result).toEqual({ sessionId: 'sess-live', live: true })
    expect(state.spawner.getSessionId).toHaveBeenCalledWith('th_1')
    expect(state.spawner.hasLiveSession).toHaveBeenCalledWith('th_1')
  })

  it('reports a bound-but-dead PTY as live: false (dead state, never a respawn)', async () => {
    state.spawner.getSessionId.mockReturnValue('sess-stale')
    state.spawner.hasLiveSession.mockReturnValue(false)
    const result = await invoke('cli-thread:get-session', { threadId: 'th_1' })
    expect(result).toEqual({ sessionId: 'sess-stale', live: false })
  })

  it('returns null when the thread never had a PTY in this app run', async () => {
    state.spawner.getSessionId.mockReturnValue(undefined)
    const result = await invoke('cli-thread:get-session', { threadId: 'th_none' })
    expect(result).toBeNull()
  })
})

// ── Step 6 (contracts §5 v1.2.6): maxTurns breach wiring ──

describe('checkMaxTurnsOnTurnStarted', () => {
  function makeBreaker() {
    return { noteTurnStarted: vi.fn(), noteMaxTurns: vi.fn() }
  }
  const info = { threadId: 'th1', agentId: 'test-fixer', cwd: '/repo', invocationCount: 11 }

  it('resets the breaker episode on EVERY turn, then trips when the count exceeds the budget', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(info, () => ({ maxTurns: 10, maxWritesPerMinute: 10 }), breaker)
    expect(breaker.noteTurnStarted).toHaveBeenCalledExactlyOnceWith({
      threadId: 'th1',
      agentId: 'test-fixer'
    })
    expect(breaker.noteMaxTurns).toHaveBeenCalledExactlyOnceWith({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
  })

  it('budget N allows exactly N invocations — count == maxTurns does not trip', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(
      { ...info, invocationCount: 10 },
      () => ({ maxTurns: 10, maxWritesPerMinute: 10 }),
      breaker
    )
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
  })

  it('threads with no bound budgets snapshot are never budget-tripped', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted({ ...info, invocationCount: 999 }, () => undefined, breaker)
    expect(breaker.noteTurnStarted).toHaveBeenCalledTimes(1)
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
  })
})
