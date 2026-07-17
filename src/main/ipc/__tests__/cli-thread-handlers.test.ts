// @vitest-environment node
/**
 * Handler-level tests for the cli-thread:* IPC handlers (workstation step 1):
 * the per-turn cwd comes from the renderer request — main performs no
 * vault-path config read on this path — and the model-flag trust rule lives
 * here at the IPC boundary (Phase 2 step 1): only an explicit pick that is in
 * the adapter's roster AND passes the charset check is forwarded; anything
 * else forwards undefined, with an audit note for explicit-but-rejected picks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import type { AuditEntry } from '@shared/agent-types'
import type { IpcRequest } from '@shared/ipc-channels'

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
  auditEntries: [] as unknown[],
  // P3 step 4: main-side user-message persistence. appendMessage resolves
  // true by default — every dispatch appends before validation, so a
  // fail-closed default would break every fixture in this file.
  appendMessage: vi.fn(async (_root: string, _id: string, _message: unknown) => true),
  sends: [] as Array<{ event: string; data: unknown }>,
  mainWindow: {} as unknown,
  // P3 step 4: the test-dispatch channel is double-locked on
  // !app.isPackaged && MACHINA_E2E=1 — the gating suite flips this.
  isPackaged: false,
  // P3 step 4 wiring seams: getSpawner's constructor options (captured so the
  // waitForSessionReady wiring is pinned, not just the injected mock) and the
  // shell-readiness delegation target.
  spawnerCtorOpts: [] as Array<Record<string, unknown>>,
  waitForFirstBlock: vi.fn(async (_sessionId: string) => true)
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  }),
  typedSend: vi.fn((_window: unknown, event: string, data: unknown) => {
    state.sends.push({ event, data })
  })
}))

vi.mock('../../window-registry', () => ({
  getMainWindow: vi.fn(() => state.mainWindow)
}))

vi.mock('../../services/thread-storage', () => ({
  ThreadStorage: class {
    constructor(private readonly root: string) {}
    appendMessage(id: string, message: unknown): Promise<boolean> {
      return state.appendMessage(this.root, id, message)
    }
  }
}))

vi.mock('../../services/cli-thread-spawner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/cli-thread-spawner')>()
  return {
    ...actual,
    CliThreadSpawner: class {
      constructor(opts: Record<string, unknown>) {
        state.spawnerCtorOpts.push(opts)
      }
      spawn = state.spawner.spawn
      input = state.spawner.input
      close = state.spawner.close
      cancel = state.spawner.cancel
      getSessionId = state.spawner.getSessionId
      hasLiveSession = state.spawner.hasLiveSession
    }
  }
})

vi.mock('../../services/shell-readiness', () => ({
  waitForFirstBlock: (sessionId: string) => state.waitForFirstBlock(sessionId)
}))

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
  app: {
    getPath: vi.fn(() => '/nonexistent-test-userdata'),
    get isPackaged() {
      return state.isPackaged
    }
  }
}))

vi.mock('../shell', () => ({
  getShellService: vi.fn(() => ({})),
  getCliAgentThreadBridge: vi.fn(() => ({}))
}))

vi.mock('../config', () => ({
  readAppConfigValue: state.readAppConfigValue
}))

import { checkMaxTurnsOnTurnStarted, dispatchAgentTurn, registerCliThreadIpc } from '../cli-thread'

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
  const info = {
    threadId: 'th1',
    agentId: 'test-fixer',
    cwd: '/repo',
    invocationCount: 11,
    slugInvocationCount: 11
  }

  it('resets the breaker episode on EVERY turn, then trips when the count exceeds the budget', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(
      info,
      () => ({ slug: 'test-fixer', budgets: { maxTurns: 10, maxWritesPerMinute: 10 } }),
      breaker
    )
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
      () => ({ slug: 'test-fixer', budgets: { maxTurns: 10, maxWritesPerMinute: 10 } }),
      breaker
    )
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
  })

  it('threads with no bound budgets snapshot are never budget-tripped', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted({ ...info, invocationCount: 999 }, () => undefined, breaker)
    expect(breaker.noteTurnStarted).toHaveBeenCalledTimes(1)
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
    // A binding WITHOUT a budgets snapshot (backfill, pre-step-6) is the
    // same non-enforcing shape.
    checkMaxTurnsOnTurnStarted(
      { ...info, invocationCount: 999 },
      () => ({ slug: 'test-fixer' }),
      breaker
    )
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
  })
})

// ── Phase 3 step 5: per-(root, slug) aggregate ceiling (maxTurnsPerSlug) ──

describe('checkMaxTurnsOnTurnStarted slug aggregate (step 5)', () => {
  function makeBreaker() {
    return { noteTurnStarted: vi.fn(), noteMaxTurns: vi.fn() }
  }
  const base = { agentId: 'test-fixer', cwd: '/repo' }
  const budgets = { maxTurns: 10, maxWritesPerMinute: 10, maxTurnsPerSlug: 5 }
  const binding = { slug: 'test-fixer', budgets }

  it('an absent maxTurnsPerSlug never trips on the aggregate (attended parity)', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(
      { ...base, threadId: 'thA', invocationCount: 1, slugInvocationCount: 999 },
      () => ({ slug: 'test-fixer', budgets: { maxTurns: 10, maxWritesPerMinute: 10 } }),
      breaker
    )
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
  })

  it('aggregate budget N allows exactly N invocations; the N+1th trips on the breaching thread', () => {
    const breaker = makeBreaker()
    // Thread A sends 3, thread B sends 2 — aggregate exactly 5, no trip.
    const sends = [
      { threadId: 'thA', invocationCount: 1, slugInvocationCount: 1 },
      { threadId: 'thA', invocationCount: 2, slugInvocationCount: 2 },
      { threadId: 'thB', invocationCount: 1, slugInvocationCount: 3 },
      { threadId: 'thA', invocationCount: 3, slugInvocationCount: 4 },
      { threadId: 'thB', invocationCount: 2, slugInvocationCount: 5 }
    ]
    for (const send of sends) {
      checkMaxTurnsOnTurnStarted({ ...base, ...send }, () => binding, breaker)
    }
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
    // B's next send breaches the aggregate while both per-thread counts sit
    // far under maxTurns — the trip lands on the thread that fired it.
    checkMaxTurnsOnTurnStarted(
      { ...base, threadId: 'thB', invocationCount: 3, slugInvocationCount: 6 },
      () => binding,
      breaker
    )
    expect(breaker.noteMaxTurns).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thB',
      agentId: 'test-fixer',
      scope: 'slug',
      invocationCount: 6,
      maxTurns: 5
    })
  })

  it('a per-thread breach still trips independently, without the slug scope', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(
      { ...base, threadId: 'thA', invocationCount: 11, slugInvocationCount: 3 },
      () => binding,
      breaker
    )
    expect(breaker.noteMaxTurns).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thA',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
  })

  it('both ceilings breached ⇒ a single noteMaxTurns call (per-thread first, early return)', () => {
    const breaker = makeBreaker()
    checkMaxTurnsOnTurnStarted(
      { ...base, threadId: 'thA', invocationCount: 11, slugInvocationCount: 6 },
      () => binding,
      breaker
    )
    expect(breaker.noteMaxTurns).toHaveBeenCalledTimes(1)
    expect(breaker.noteMaxTurns.mock.calls[0][0]).toMatchObject({ maxTurns: 10 })
  })

  it('a turn counted under a foreign pool is never judged against the slug ceiling (v1.3.4 review fix)', () => {
    // Degraded attribution (registry-error / adapter-unknown): the turn's
    // agentId fell back to the adapter identity, so slugInvocationCount is
    // the SHARED cli-claude pool — here inflated to 61 by unrelated ad-hoc
    // traffic. Judging it against this binding's maxTurnsPerSlug (50) would
    // kill-class a thread whose real slug aggregate is untouched.
    const breaker = makeBreaker()
    const degradedBinding = {
      slug: 'test-fixer',
      budgets: { maxTurns: 100, maxWritesPerMinute: 10, maxTurnsPerSlug: 50 }
    }
    checkMaxTurnsOnTurnStarted(
      {
        threadId: 'thA',
        agentId: 'cli-claude',
        cwd: '/repo',
        invocationCount: 1,
        slugInvocationCount: 61
      },
      () => degradedBinding,
      breaker
    )
    expect(breaker.noteMaxTurns).not.toHaveBeenCalled()
    // The per-thread ceiling is pool-independent and still binds the
    // degraded turn.
    checkMaxTurnsOnTurnStarted(
      {
        threadId: 'thA',
        agentId: 'cli-claude',
        cwd: '/repo',
        invocationCount: 101,
        slugInvocationCount: 62
      },
      () => degradedBinding,
      breaker
    )
    expect(breaker.noteMaxTurns).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thA',
      agentId: 'cli-claude',
      invocationCount: 101,
      maxTurns: 100
    })
  })
})

// ── Phase 3 step 4 (contracts §4 v1.3.3): dispatchAgentTurn factoring ──

type InputArgs = IpcRequest<'cli-thread:input'>

interface ParityCapture {
  inputCalls: unknown[][]
  audits: Array<Omit<AuditEntry, 'ts'>>
  result: unknown
}

/** Run one dispatch and snapshot its observable effects (ts stripped from audits). */
async function captureDispatch(run: () => Promise<unknown>): Promise<ParityCapture> {
  state.spawner.input.mockClear()
  state.auditEntries.length = 0
  const result = await run()
  return {
    inputCalls: state.spawner.input.mock.calls.map((call) => [...call]),
    audits: (state.auditEntries as AuditEntry[]).map(({ ts: _ts, ...rest }) => rest),
    result
  }
}

const RAW_BINDING = {
  slug: 'raw-runner',
  workspaceRoot: '/v',
  adapter: 'raw',
  invocationTemplate: "trusted '--ask' {prompt}"
} as const

const PARITY_MATRIX: ReadonlyArray<{
  name: string
  binding: Record<string, unknown> | undefined
  args: InputArgs
  expectedInputCalls: unknown[][]
  expectedResult: { ok: boolean }
  expectedAudit?: { tool: string; channel?: string }
}> = [
  {
    name: 'structured ok (unbound ad-hoc turn)',
    binding: undefined,
    args: { threadId: 'th_p1', identity: 'cli-claude', text: 'go', cwd: '/v' },
    expectedInputCalls: [['th_p1', 'cli-claude', 'go', '/v', undefined, undefined, false]],
    expectedResult: { ok: true }
  },
  {
    name: 'raw ok (bound snapshot template forwarded, 8-arg branch)',
    binding: RAW_BINDING,
    args: { threadId: 'th_p2', identity: 'cli-raw', text: 'go', cwd: '/v', agentId: 'raw-runner' },
    expectedInputCalls: [
      ['th_p2', 'cli-raw', 'go', '/v', 'raw-runner', undefined, false, "trusted '--ask' {prompt}"]
    ],
    expectedResult: { ok: true }
  },
  {
    name: 'adapter mismatch blocks before the spawner',
    binding: { slug: 'bound-runner', workspaceRoot: '/v', adapter: 'claude' },
    args: {
      threadId: 'th_p3',
      identity: 'cli-raw',
      text: 'go',
      cwd: '/v',
      agentId: 'bound-runner'
    },
    expectedInputCalls: [],
    expectedResult: { ok: false },
    expectedAudit: { tool: 'cli-agent:attribution-mismatch', channel: 'cli-thread:input' }
  },
  {
    name: 'invalid model pick audited, adapter default forwarded',
    binding: undefined,
    args: { threadId: 'th_p4', identity: 'cli-codex', text: 'go', cwd: '/v', model: 'sonnet' },
    expectedInputCalls: [['th_p4', 'cli-codex', 'go', '/v', undefined, undefined, false]],
    expectedResult: { ok: true },
    expectedAudit: { tool: 'cli-thread:input' }
  },
  {
    name: 'malformed agentId degrades + audits',
    binding: undefined,
    args: { threadId: 'th_p5', identity: 'cli-claude', text: 'go', cwd: '/v', agentId: 'bad id!' },
    expectedInputCalls: [['th_p5', 'cli-claude', 'go', '/v', undefined, undefined, true]],
    expectedResult: { ok: true },
    expectedAudit: { tool: 'cli-agent:attribution-mismatch', channel: 'cli-thread:input' }
  }
]

describe('dispatchAgentTurn ↔ cli-thread:input parity (Phase 3 step 4)', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  afterEach(() => {
    state.registry.get.mockImplementation(() => undefined)
  })

  it.each(PARITY_MATRIX)(
    '$name: identical spawner call, audits, and result on both entry points',
    async ({ binding, args, expectedInputCalls, expectedResult, expectedAudit }) => {
      state.registry.get.mockImplementation(() => binding as never)
      const viaHandler = await captureDispatch(() => invoke('cli-thread:input', args))
      const viaExport = await captureDispatch(() => dispatchAgentTurn(args))

      // Parity: the handler is a thin caller — one dispatch body, two doors.
      expect(viaExport.result).toEqual(viaHandler.result)
      expect(viaExport.inputCalls).toEqual(viaHandler.inputCalls)
      expect(viaExport.audits).toEqual(viaHandler.audits)

      // Non-vacuous: both match the concrete expected validation outcome.
      expect(viaExport.result).toEqual(expectedResult)
      expect(viaExport.inputCalls).toEqual(expectedInputCalls)
      if (expectedAudit === undefined) {
        expect(viaExport.audits).toEqual([])
      } else {
        expect(viaExport.audits).toHaveLength(1)
        expect(viaExport.audits[0].tool).toBe(expectedAudit.tool)
        if (expectedAudit.channel !== undefined) {
          expect(viaExport.audits[0].args).toMatchObject({ channel: expectedAudit.channel })
        }
      }
    }
  )

  it('a non-default origin relabels audit entries without changing dispatch behavior', async () => {
    state.registry.get.mockImplementation(() => undefined)
    const args: InputArgs = {
      threadId: 'th_o1',
      identity: 'cli-codex',
      text: 'go',
      cwd: '/v',
      model: 'sonnet',
      agentId: 'bad id!'
    }
    const viaDefault = await captureDispatch(() => dispatchAgentTurn(args))
    const viaTestChannel = await captureDispatch(() =>
      dispatchAgentTurn(args, 'cli-thread:test-dispatch')
    )

    // Same validation outcome and spawner call — origin is a label, not a fork.
    expect(viaTestChannel.result).toEqual(viaDefault.result)
    expect(viaTestChannel.inputCalls).toEqual(viaDefault.inputCalls)

    // Both the degrade audit (args.channel) and the model-denial audit (tool)
    // carry the origin: unattended dispatches never masquerade as renderer turns.
    const degrade = viaTestChannel.audits.find((e) => e.tool === 'cli-agent:attribution-mismatch')
    expect(degrade?.args).toMatchObject({ channel: 'cli-thread:test-dispatch' })
    expect(viaTestChannel.audits.some((e) => e.tool === 'cli-thread:test-dispatch')).toBe(true)
    const defaultDegrade = viaDefault.audits.find(
      (e) => e.tool === 'cli-agent:attribution-mismatch'
    )
    expect(defaultDegrade?.args).toMatchObject({ channel: 'cli-thread:input' })
  })
})

// ── Phase 3 step 4 (contracts §4 v1.3.3): main-side user-message persistence ──

describe('dispatchAgentTurn main-side user-message persistence (Phase 3 step 4)', () => {
  const args: InputArgs = {
    threadId: 'th_u1',
    identity: 'cli-claude',
    text: 'fix the tests',
    cwd: '/repos/project'
  }

  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
    state.sends.length = 0
    state.mainWindow = {}
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('appends the user message to the turn root BEFORE the spawner input', async () => {
    const result = await invoke<{ ok: boolean }>('cli-thread:input', args)
    expect(result).toEqual({ ok: true })
    expect(state.appendMessage).toHaveBeenCalledExactlyOnceWith('/repos/project', 'th_u1', {
      role: 'user',
      body: 'fix the tests',
      sentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    })
    // Ordering: durable user message before the send (and before turnStarted,
    // which fires inside the spawner's sendUserMessage downstream of input).
    expect(state.appendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      state.spawner.input.mock.invocationCallOrder[0]
    )
  })

  it('a false append (missing thread file) fails closed: no spawner call, no thread:changed', async () => {
    state.appendMessage.mockResolvedValueOnce(false)
    const result = await dispatchAgentTurn(args)
    expect(result).toEqual({ ok: false })
    expect(state.spawner.input).not.toHaveBeenCalled()
    expect(state.sends).toEqual([])
  })

  it('emits thread:changed { root, threadId } only after a successful append', async () => {
    await dispatchAgentTurn(args)
    expect(state.sends).toEqual([
      { event: 'thread:changed', data: { root: '/repos/project', threadId: 'th_u1' } }
    ])
  })

  it('skips the thread:changed emit when no main window exists (headless safety)', async () => {
    state.mainWindow = null
    const result = await dispatchAgentTurn(args)
    expect(result).toEqual({ ok: true })
    expect(state.sends).toEqual([])
    expect(state.spawner.input).toHaveBeenCalledTimes(1)
  })

  it('appends the user message even for a turn blocked by adapter mismatch (refusal on disk)', async () => {
    state.registry.get.mockImplementation(
      () => ({ slug: 'bound-runner', workspaceRoot: '/v', adapter: 'claude' }) as never
    )
    const result = await dispatchAgentTurn({
      ...args,
      identity: 'cli-raw',
      agentId: 'bound-runner'
    })
    state.registry.get.mockImplementation(() => undefined)
    expect(result).toEqual({ ok: false })
    expect(state.appendMessage).toHaveBeenCalledTimes(1)
    expect(state.spawner.input).not.toHaveBeenCalled()
  })
})

// ── Phase 3 step 4 (contracts §4/§6 v1.3.3): dev-only test-dispatch channel ──

describe('cli-thread:test-dispatch gating (Phase 3 step 4)', () => {
  const args: InputArgs = {
    threadId: 'th_g1',
    identity: 'cli-claude',
    text: 'go',
    cwd: '/v'
  }

  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
    state.sends.length = 0
    state.mainWindow = {}
    state.isPackaged = false
    delete process.env['MACHINA_E2E']
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env['MACHINA_E2E']
    state.isPackaged = false
  })

  it('is NOT registered when MACHINA_E2E is unset', () => {
    registerCliThreadIpc()
    expect(state.handlers.has('cli-thread:test-dispatch')).toBe(false)
    // The production channels are unaffected by the gate.
    expect(state.handlers.has('cli-thread:input')).toBe(true)
  })

  it('is NOT registered under a truthy-but-wrong env value', () => {
    process.env['MACHINA_E2E'] = 'true'
    registerCliThreadIpc()
    expect(state.handlers.has('cli-thread:test-dispatch')).toBe(false)
  })

  it('is NOT registered in a packaged build even with MACHINA_E2E=1 (double lock)', () => {
    state.isPackaged = true
    process.env['MACHINA_E2E'] = '1'
    registerCliThreadIpc()
    expect(state.handlers.has('cli-thread:test-dispatch')).toBe(false)
  })

  it('registers under MACHINA_E2E=1 non-packaged and delegates to dispatchAgentTurn', async () => {
    process.env['MACHINA_E2E'] = '1'
    registerCliThreadIpc()
    const result = await invoke<{ ok: boolean }>('cli-thread:test-dispatch', args)
    expect(result).toEqual({ ok: true })
    // Full dispatch body, not a fork: user-message append + spawner input.
    expect(state.appendMessage).toHaveBeenCalledExactlyOnceWith('/v', 'th_g1', {
      role: 'user',
      body: 'go',
      sentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    })
    expect(state.spawner.input).toHaveBeenCalledExactlyOnceWith(
      'th_g1',
      'cli-claude',
      'go',
      '/v',
      undefined,
      undefined,
      false
    )
  })

  it('labels channel-invoked audit entries with the test-dispatch origin', async () => {
    process.env['MACHINA_E2E'] = '1'
    registerCliThreadIpc()
    await invoke('cli-thread:test-dispatch', {
      ...args,
      identity: 'cli-codex',
      model: 'sonnet',
      agentId: 'bad id!'
    })
    const audits = state.auditEntries as AuditEntry[]
    const degrade = audits.find((e) => e.tool === 'cli-agent:attribution-mismatch')
    expect(degrade?.args).toMatchObject({ channel: 'cli-thread:test-dispatch' })
    expect(audits.some((e) => e.tool === 'cli-thread:test-dispatch')).toBe(true)
    expect(audits.some((e) => e.tool === 'cli-thread:input')).toBe(false)
  })
})

// ── Phase 3 step 4 review hardening: the getSpawner readiness wiring seam ──

describe('getSpawner readiness wiring (Phase 3 step 4)', () => {
  beforeEach(() => {
    state.handlers.clear()
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('constructs the spawner with waitForSessionReady delegating to shell-readiness', async () => {
    // The spawner singleton is minted on the first dispatch of the module's
    // lifetime; ensure at least one ran, then inspect the captured options.
    await invoke('cli-thread:input', {
      threadId: 'th_w1',
      identity: 'cli-claude',
      text: 'go',
      cwd: '/v'
    })
    expect(state.spawnerCtorOpts.length).toBeGreaterThan(0)
    const wait = state.spawnerCtorOpts[0]['waitForSessionReady'] as
      | ((sessionId: string) => Promise<boolean>)
      | undefined
    // Deleting the getSpawner wiring line would resurrect the Phase-1 step-6
    // lost-reply race while every mock-injected suite stayed green — pin the
    // real seam: the option exists and delegates to waitForFirstBlock.
    if (wait === undefined) throw new Error('waitForSessionReady not wired in getSpawner')
    state.waitForFirstBlock.mockClear()
    await expect(wait('sess-w1')).resolves.toBe(true)
    expect(state.waitForFirstBlock).toHaveBeenCalledExactlyOnceWith('sess-w1')
  })
})

// ── Phase 3 step 4 review hardening: per-thread dispatch serialization ──

describe('dispatchAgentTurn per-thread serialization (Phase 3 step 4)', () => {
  const argsA: InputArgs = { threadId: 'th_s1', identity: 'cli-claude', text: 'first', cwd: '/v' }

  beforeEach(() => {
    state.handlers.clear()
    state.auditEntries.length = 0
    state.sends.length = 0
    state.mainWindow = {}
    vi.clearAllMocks()
    registerCliThreadIpc()
  })

  it('overlapping dispatches for ONE thread run strictly FIFO — the second never starts early', async () => {
    let release: ((result: { ok: boolean }) => void) | undefined
    state.spawner.input.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          release = resolve
        })
    )
    const first = dispatchAgentTurn(argsA)
    await vi.waitFor(() => expect(state.spawner.input).toHaveBeenCalledTimes(1))
    const second = dispatchAgentTurn({ ...argsA, text: 'second' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    // While turn 1 is in flight, turn 2 must not have appended or sent: its
    // send would land in turn 1's not-yet-ready PTY and its per-thread
    // spawner-map/turn-window writes would corrupt turn 1's attribution.
    expect(state.appendMessage).toHaveBeenCalledTimes(1)
    expect(state.spawner.input).toHaveBeenCalledTimes(1)
    release?.({ ok: true })
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
    expect(state.appendMessage).toHaveBeenCalledTimes(2)
    expect(state.spawner.input).toHaveBeenCalledTimes(2)
    expect(state.spawner.input.mock.calls.map((call) => call[2])).toEqual(['first', 'second'])
  })

  it('a rejected dispatch surfaces to its own caller and never wedges the thread queue', async () => {
    state.appendMessage.mockRejectedValueOnce(new Error('disk on fire'))
    await expect(dispatchAgentTurn(argsA)).rejects.toThrow('disk on fire')
    await expect(dispatchAgentTurn({ ...argsA, text: 'after' })).resolves.toEqual({ ok: true })
  })

  it('dispatches for DIFFERENT threads stay concurrent', async () => {
    let release: ((result: { ok: boolean }) => void) | undefined
    state.spawner.input.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          release = resolve
        })
    )
    const blocked = dispatchAgentTurn(argsA)
    await vi.waitFor(() => expect(state.spawner.input).toHaveBeenCalledTimes(1))
    await expect(dispatchAgentTurn({ ...argsA, threadId: 'th_s2' })).resolves.toEqual({ ok: true })
    release?.({ ok: true })
    await expect(blocked).resolves.toEqual({ ok: true })
  })
})
