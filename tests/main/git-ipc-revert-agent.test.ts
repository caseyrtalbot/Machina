// @vitest-environment node
/**
 * git:revert-agent handler wiring (post-merge review hardening, v1.2.7).
 *
 * A tray revert during a LIVE agent turn must not read as agent activity:
 * the handler suppresses the reverted paths on the watcher BEFORE the gate's
 * own writes hit the tree (mirroring the discard wrapper's suppression), and
 * excuses the new revert commit sha for every open turn window (mirroring
 * commitApproved's noteQueueCommit excusal). Pre-fix, the revert's writes
 * were attributed to the open turn, isAgentHeadMove computed true, and the
 * circuit breaker killed the healthy agent.
 *
 * Electron and the IPC plumbing are mocked (same pattern as
 * git-ipc-list-agent-commits.test.ts); git-service and the turn registry run
 * REAL against a temp repo. AgentWriteWatcher is mocked to observe suppress().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitOpResult } from '../../src/shared/git-types'

const wsCtl = vi.hoisted(() => ({ root: null as string | null }))

const ipcCtl = vi.hoisted(() => ({
  handlers: new Map<string, (args?: unknown) => unknown>()
}))

const watcherCtl = vi.hoisted(() => ({
  suppressed: [] as string[][]
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => join(tmpdir(), 'te-revert-agent-ipc-userdata')) },
  shell: { trashItem: vi.fn() }
}))

vi.mock('../../src/main/typed-ipc', () => ({
  typedHandle: (channel: string, handler: (args?: unknown) => unknown) => {
    ipcCtl.handlers.set(channel, handler)
  },
  typedSend: vi.fn()
}))

vi.mock('../../src/main/window-registry', () => ({
  getMainWindow: () => null
}))

vi.mock('../../src/main/services/workspace-service', () => ({
  getWorkspaceService: () => ({
    current: () => (wsCtl.root === null ? null : { root: wsCtl.root })
  })
}))

vi.mock('../../src/main/ipc/documents', () => ({
  getDocumentManager: () => ({ hasPendingWrite: () => false })
}))

vi.mock('../../src/main/services/audit-logger', () => ({
  AuditLogger: class {
    log = vi.fn()
  }
}))

vi.mock('../../src/main/services/agent-write-watcher', () => ({
  AgentWriteWatcher: class {
    constructor(_deps: unknown) {
      // stub: the revert tests never start a real watcher
    }
    async start(): Promise<void> {
      // stub
    }
    async stop(): Promise<void> {
      // stub
    }
    suppress(paths: readonly string[]): void {
      watcherCtl.suppressed.push([...paths])
    }
  }
}))

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, stdio: 'ignore' } as const
  execFileSync('git', ['init', '--quiet'], opts)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts)
  execFileSync('git', ['config', 'user.name', 'Test'], opts)
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts)
  writeFileSync(join(dir, '.gitkeep'), '')
  execFileSync('git', ['add', '.'], opts)
  execFileSync('git', ['commit', '-m', 'initial', '--quiet', '--no-verify'], opts)
}

/** One agent-attributed commit (real trailers, real repo). */
function agentCommit(dir: string, agentId: string, file: string): void {
  writeFileSync(join(dir, file), `${agentId} wrote this\n`)
  execFileSync('git', ['add', '--', file], { cwd: dir, stdio: 'ignore' })
  execFileSync(
    'git',
    [
      'commit',
      '--no-verify',
      '-m',
      `agent writes ${file}`,
      '-m',
      `Machina-Agent: ${agentId}\nMachina-Session: th-00000001`
    ],
    { cwd: dir, stdio: 'ignore' }
  )
}

let tempRoot: string | null = null

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ipcCtl.handlers.clear()
  watcherCtl.suppressed = []
  wsCtl.root = null
})

afterEach(() => {
  if (tempRoot !== null) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('git:revert-agent handler (revert during a live turn, v1.2.7)', () => {
  it('suppresses the reverted paths on the watcher and excuses the revert sha for open turns', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'te-revert-agent-ipc-'))
    initGitRepo(tempRoot)
    agentCommit(tempRoot, 'test-fixer', 'agent-file.txt')
    wsCtl.root = tempRoot

    const gitIpc = await import('../../src/main/ipc/git')
    const registry = await import('../../src/main/services/cli-turn-registry')
    const gitService = await import('../../src/main/services/git-service')

    gitIpc.registerGitIpc()
    await gitIpc.initApprovalsForRoot(tempRoot)

    // A live agent turn is open when the user reverts from the tray.
    registry.setPtyAliveProbe(() => true)
    registry.getCliTurnRegistry().turnStarted({
      threadId: 'th-live',
      agentId: 'test-fixer',
      cwd: tempRoot
    })

    const handler = ipcCtl.handlers.get('git:revert-agent')
    expect(handler).toBeDefined()
    const result = (await handler!({ agentId: 'test-fixer' })) as GitOpResult
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 1. The revert's own file writes were suppressed on the CURRENT watcher
    //    before the tree changed — they never reach turn attribution.
    expect(watcherCtl.suppressed).toEqual([['agent-file.txt']])

    // 2. The revert commit sha is excused on the open turn window, so the
    //    headMoved tripwire does not read the revert as an agent HEAD move.
    const match = registry.getCliTurnRegistry().activeTurnFor(tempRoot)
    expect(match).not.toBeNull()
    expect(match!.turn.queueCommitShas).toContain(result.sha)
    expect(
      registry.isAgentHeadMove(match!.turn, gitService.headSha(tempRoot), gitService.commitsBetween)
    ).toBe(false)
  })

  it('excuses nothing on a failed revert (no sha, no suppression side effects beyond the hook)', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'te-revert-agent-ipc-fail-'))
    initGitRepo(tempRoot)
    wsCtl.root = tempRoot

    const gitIpc = await import('../../src/main/ipc/git')
    const registry = await import('../../src/main/services/cli-turn-registry')

    gitIpc.registerGitIpc()
    await gitIpc.initApprovalsForRoot(tempRoot)

    registry.setPtyAliveProbe(() => true)
    registry.getCliTurnRegistry().turnStarted({
      threadId: 'th-live',
      agentId: 'ghost',
      cwd: tempRoot
    })

    const handler = ipcCtl.handlers.get('git:revert-agent')
    const result = (await handler!({ agentId: 'ghost' })) as GitOpResult
    expect(result).toEqual({ ok: false, reason: 'no-commits-for-agent' })

    const match = registry.getCliTurnRegistry().activeTurnFor(tempRoot)
    expect(match!.turn.queueCommitShas).toEqual([])
  })
})
