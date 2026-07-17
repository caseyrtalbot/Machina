// @vitest-environment node
/**
 * shell.ts wiring seams for the P3 step 4 persistence cutover (contracts §4
 * v1.3.3). The bridge suite pins that onTurnComplete RECEIVES
 * (threadId, message, bindCwd); this suite pins that shell.ts USES them — the
 * single writer of the assistant final. Mutation killers: `closed?.cwd ??
 * bindCwd` degrading to `''`/`closed!.cwd` (the mid-turn-kill lost-reply
 * regression), deleting the thread:changed emit, deleting the
 * markBlockSeen/clearSession readiness taps (which would silently turn every
 * fresh-spawn wait into a 10s timeout no-op).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AssistantMessage } from '@shared/thread-types'

const state = vi.hoisted(() => ({
  bridgeOpts: [] as Array<{
    onMessage: (event: unknown) => void
    onTurnComplete?: (
      threadId: string,
      message: unknown,
      cwd: string,
      costUsd: number | null
    ) => void
  }>,
  watcherOpts: [] as Array<{
    onUpdate: (update: { sessionId: string; block: unknown }) => void
  }>,
  exitCallbacks: [] as Array<(sessionId: string, code: number) => void>,
  // (root, id, message) — the ThreadStorage mock threads its ctor root in.
  appendMessage: vi.fn(async (_root: string, _id: string, _message: unknown) => true),
  turnEnded: vi.fn((_threadId: string): { cwd: string; agentId?: string } | undefined => undefined),
  checkHeadMovedAtTurnEnd: vi.fn(),
  markBlockSeen: vi.fn(),
  clearSession: vi.fn(),
  auditEntries: [] as Array<Record<string, unknown>>,
  winSend: vi.fn(),
  // Cost vertical (P3 step 5): the bridge cumulative the mocked
  // getThreadCostUsd returns, plus spies for the breaker/registry/ledger.
  threadCostUsd: undefined as number | undefined,
  noteCost: vi.fn(),
  ensureRootReady: vi.fn(async (_root: string) => {}),
  registryGet: vi.fn((_root: string, _threadId: string): { slug: string } | undefined => undefined),
  recordSpend: vi.fn(async (_root: string, _slug: string, _usd: number) => {})
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/te-test-userdata'), getAppPath: vi.fn(() => '/tmp/te-app') },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('../../services/shell-service', () => ({
  ShellService: class {
    setCallbacks(_onData: unknown, onExit: (sessionId: string, code: number) => void): void {
      state.exitCallbacks.push(onExit)
    }
    create = vi.fn(() => 'sess-created')
    write = vi.fn()
    sendRawKeys = vi.fn()
    resize = vi.fn()
    kill = vi.fn()
    getProcessName = vi.fn()
    reconnect = vi.fn()
    getPtyService = vi.fn()
  }
}))

vi.mock('../../services/block-watcher', () => ({
  BlockWatcher: class {
    constructor(opts: { onUpdate: (update: { sessionId: string; block: unknown }) => void }) {
      state.watcherOpts.push(opts)
    }
    observe = vi.fn()
    closeSession = vi.fn()
  }
}))

vi.mock('../../services/cli-agent-session-listener', () => ({
  CLIAgentSessionListener: class {
    observe = vi.fn()
    closeSession = vi.fn()
  }
}))

vi.mock('../../services/cli-agent-thread-bridge', () => ({
  CliAgentThreadBridge: class {
    constructor(opts: (typeof state.bridgeOpts)[number]) {
      state.bridgeOpts.push(opts)
    }
    observe = vi.fn()
    closeSession = vi.fn()
    getThreadCostUsd = (_threadId: string): number | undefined => state.threadCostUsd
  }
}))

vi.mock('../../services/agent-circuit-breaker', () => ({
  getAgentCircuitBreaker: () => ({ noteCost: state.noteCost })
}))

vi.mock('../../services/harness-run-registry', () => ({
  getHarnessRunRegistry: () => ({
    ensureRootReady: state.ensureRootReady,
    get: state.registryGet
  })
}))

vi.mock('../../services/agent-cost-ledger', () => ({
  getAgentCostLedger: () => ({ recordSpend: state.recordSpend })
}))

vi.mock('../../services/cli-turn-registry', () => ({
  getCliTurnRegistry: () => ({ turnEnded: state.turnEnded })
}))

vi.mock('../../services/shell-readiness', () => ({
  markBlockSeen: state.markBlockSeen,
  clearSession: state.clearSession
}))

vi.mock('../../services/thread-storage', () => ({
  ThreadStorage: class {
    constructor(private readonly root: string) {}
    appendMessage(id: string, message: unknown): Promise<boolean> {
      return state.appendMessage(this.root, id, message)
    }
  }
}))

vi.mock('../../services/audit-logger', () => ({
  AuditLogger: class {
    log(entry: Record<string, unknown>): void {
      state.auditEntries.push(entry)
    }
  }
}))

vi.mock('../git', () => ({
  checkHeadMovedAtTurnEnd: state.checkHeadMovedAtTurnEnd
}))

vi.mock('../../window-registry', () => ({
  getMainWindow: () => ({ webContents: { isDestroyed: () => false, send: state.winSend } })
}))

// Import AFTER the mocks: shell.ts constructs its bridge/watcher at module
// top level, so the captured options come from this import.
import { registerShellIpc } from '../shell'

const FINAL: AssistantMessage = {
  role: 'assistant',
  body: 'done',
  sentAt: '2026-07-15T10:00:00.000Z'
}

function onTurnComplete(): (
  threadId: string,
  message: unknown,
  cwd: string,
  costUsd: number | null
) => void {
  const cb = state.bridgeOpts[0]?.onTurnComplete
  if (cb === undefined) throw new Error('bridge onTurnComplete not wired in shell.ts')
  return cb
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function threadChangedSends(): unknown[] {
  return state.winSend.mock.calls.filter((call) => call[0] === 'thread:changed')
}

describe('shell.ts onTurnComplete persistence closure (P3 step 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.auditEntries.length = 0
    state.appendMessage.mockResolvedValue(true)
    state.turnEnded.mockReturnValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('persists the final under the CLOSED turn window cwd and pushes thread:changed', async () => {
    state.turnEnded.mockReturnValue({ cwd: '/turn/root' })
    onTurnComplete()('th_1', FINAL, '/bind/root', null)
    await settle()
    expect(state.checkHeadMovedAtTurnEnd).toHaveBeenCalledWith({ cwd: '/turn/root' })
    expect(state.appendMessage).toHaveBeenCalledExactlyOnceWith('/turn/root', 'th_1', FINAL)
    expect(threadChangedSends()).toEqual([
      ['thread:changed', { root: '/turn/root', threadId: 'th_1' }]
    ])
  })

  it('mid-turn kill (no turn window) falls back to the bind-time cwd — never an empty root', async () => {
    // Breaker trip / kill switch: close() wiped the spawner maps and dropped
    // the turn window BEFORE the PTY exit fired the synthetic final. The
    // bind-time cwd is the only surviving root — mutating the fallback to ''
    // (or asserting closed non-null) silently drops the synthetic final.
    state.turnEnded.mockReturnValue(undefined)
    onTurnComplete()('th_2', FINAL, '/bind/root', null)
    await settle()
    expect(state.checkHeadMovedAtTurnEnd).not.toHaveBeenCalled()
    expect(state.appendMessage).toHaveBeenCalledExactlyOnceWith('/bind/root', 'th_2', FINAL)
    expect(threadChangedSends()).toEqual([
      ['thread:changed', { root: '/bind/root', threadId: 'th_2' }]
    ])
  })

  it('a false append (thread deleted/archived) emits NO thread:changed', async () => {
    state.appendMessage.mockResolvedValue(false)
    onTurnComplete()('th_3', FINAL, '/bind/root', null)
    await settle()
    expect(threadChangedSends()).toEqual([])
  })

  it('a rejected append never rejects unhandled: no emit, console + durable audit entry', async () => {
    state.appendMessage.mockRejectedValue(new Error('ENOSPC'))
    onTurnComplete()('th_4', FINAL, '/bind/root', null)
    await settle()
    expect(threadChangedSends()).toEqual([])
    expect(console.error).toHaveBeenCalled()
    expect(state.auditEntries).toHaveLength(1)
    expect(state.auditEntries[0]).toMatchObject({
      tool: 'thread:append-failed',
      decision: 'error',
      args: { threadId: 'th_4', root: '/bind/root' }
    })
  })
})

describe('shell.ts onTurnComplete cost wiring (P3 step 5, contracts v1.3.4)', () => {
  // This block is the ONLY production caller of noteCost and recordSpend —
  // the cost vertical's cross-layer join. A mutation check showed the whole
  // block could be dead-coded with every suite green (v1.3.4 review fix), so
  // each joint is pinned: the non-null gate, the bridge-cumulative source,
  // the delta (not cumulative) into the ledger, slug gating, and the
  // ensureRootReady guard.
  beforeEach(() => {
    vi.clearAllMocks()
    state.appendMessage.mockResolvedValue(true)
    state.turnEnded.mockReturnValue(undefined)
    state.threadCostUsd = undefined
    state.ensureRootReady.mockResolvedValue(undefined)
    state.registryGet.mockReturnValue(undefined)
    state.recordSpend.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('a non-null delta feeds noteCost with the BRIDGE cumulative and the ledger with (root, slug, delta)', async () => {
    state.turnEnded.mockReturnValue({ cwd: '/turn/root', agentId: 'test-fixer' })
    state.threadCostUsd = 1.75 // cumulative ≠ delta: a cumulative/delta mixup fails here
    state.registryGet.mockReturnValue({ slug: 'test-fixer' })
    onTurnComplete()('th_c1', FINAL, '/bind/root', 0.5)
    await settle()
    expect(state.noteCost).toHaveBeenCalledExactlyOnceWith({
      threadId: 'th_c1',
      agentId: 'test-fixer',
      turnCostUsd: 0.5,
      cumulativeUsd: 1.75
    })
    // The durable ledger is keyed by (root, SLUG) and records the DELTA.
    expect(state.ensureRootReady).toHaveBeenCalledWith('/turn/root')
    expect(state.registryGet).toHaveBeenCalledWith('/turn/root', 'th_c1')
    expect(state.recordSpend).toHaveBeenCalledExactlyOnceWith('/turn/root', 'test-fixer', 0.5)
  })

  it('an unbound thread still feeds noteCost (costUsd fallback cumulative, threadId fallback agentId) but never the ledger', async () => {
    state.turnEnded.mockReturnValue(undefined) // mid-turn-kill shape: no closed window
    state.threadCostUsd = undefined // bridge never minted an entry
    state.registryGet.mockReturnValue(undefined)
    onTurnComplete()('th_c2', FINAL, '/bind/root', 0.25)
    await settle()
    expect(state.noteCost).toHaveBeenCalledExactlyOnceWith({
      threadId: 'th_c2',
      agentId: 'th_c2',
      turnCostUsd: 0.25,
      cumulativeUsd: 0.25
    })
    expect(state.recordSpend).not.toHaveBeenCalled()
  })

  it('a null delta fires neither noteCost nor the ledger (unobserved, never zeroed)', async () => {
    state.turnEnded.mockReturnValue({ cwd: '/turn/root', agentId: 'test-fixer' })
    state.registryGet.mockReturnValue({ slug: 'test-fixer' })
    onTurnComplete()('th_c3', FINAL, '/turn/root', null)
    await settle()
    expect(state.noteCost).not.toHaveBeenCalled()
    expect(state.recordSpend).not.toHaveBeenCalled()
  })

  it('a failing ensureRootReady skips the ledger but keeps noteCost (observability survives registry failure)', async () => {
    state.turnEnded.mockReturnValue({ cwd: '/turn/root', agentId: 'test-fixer' })
    state.ensureRootReady.mockRejectedValue(new Error('backfill scan exploded'))
    state.registryGet.mockReturnValue({ slug: 'test-fixer' })
    onTurnComplete()('th_c4', FINAL, '/bind/root', 0.1)
    await settle()
    expect(state.noteCost).toHaveBeenCalledTimes(1)
    expect(state.recordSpend).not.toHaveBeenCalled()
  })
})

describe('shell.ts readiness taps (P3 step 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('every blockWatcher onUpdate feeds markBlockSeen with the sessionId', () => {
    const onUpdate = state.watcherOpts[0]?.onUpdate
    if (onUpdate === undefined) throw new Error('blockWatcher onUpdate not wired in shell.ts')
    onUpdate({ sessionId: 'sess-9', block: { id: 'b1' } })
    // Deleting this tap makes every fresh-spawn waitForFirstBlock a 10s
    // timeout no-op — deterministically green everywhere else.
    expect(state.markBlockSeen).toHaveBeenCalledExactlyOnceWith('sess-9')
  })

  it('the PTY exit callback clears the readiness session', () => {
    registerShellIpc()
    const onExit = state.exitCallbacks[0]
    if (onExit === undefined) throw new Error('shellService exit callback not wired')
    onExit('sess-9', 0)
    expect(state.clearSession).toHaveBeenCalledExactlyOnceWith('sess-9')
  })
})
