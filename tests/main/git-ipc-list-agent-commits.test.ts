// @vitest-environment node
/**
 * git:list-agent-commits handler (workstation step 5, contracts §6 v1.2.5).
 *
 * The root is resolved main-side from WorkspaceService — the request carries
 * nothing — and pre-repo states come back as structured reasons, never
 * throws. Electron and the IPC plumbing are mocked (same pattern as
 * git-ipc-watcher-health.test.ts); git-service runs REAL against temp repos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentCommitsResult } from '../../src/shared/git-types'

const wsCtl = vi.hoisted(() => ({ root: null as string | null }))

const ipcCtl = vi.hoisted(() => ({
  handlers: new Map<string, (args?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => join(tmpdir(), 'te-list-agent-commits-userdata')) },
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

async function invokeListAgentCommits(): Promise<AgentCommitsResult> {
  const mod = await import('../../src/main/ipc/git')
  mod.registerGitIpc()
  const handler = ipcCtl.handlers.get('git:list-agent-commits')
  expect(handler).toBeDefined()
  return (await handler!()) as AgentCommitsResult
}

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

let tempRoot: string | null = null

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ipcCtl.handlers.clear()
  wsCtl.root = null
})

afterEach(() => {
  if (tempRoot !== null) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('git:list-agent-commits handler', () => {
  it('returns a structured no-workspace error when no workspace is open', async () => {
    wsCtl.root = null
    expect(await invokeListAgentCommits()).toEqual({ ok: false, reason: 'no-workspace' })
  })

  it('returns a structured not-a-git-repo error for a non-repo workspace', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'te-lac-nonrepo-'))
    wsCtl.root = tempRoot
    expect(await invokeListAgentCommits()).toEqual({ ok: false, reason: 'not-a-git-repo' })
  })

  it('returns a structured git-failed error when git log fails — never a false empty (v1.2.7)', async () => {
    // A .git DIRECTORY that is not a valid repo: isGitRepo passes, git log
    // fails. Pre-fix the handler wrapped this as { ok:true, agents: [] } and
    // the tray rendered "No unreverted agent commits" — the exact false empty
    // the v1.2.5 contract forbids for non-repo.
    tempRoot = mkdtempSync(join(tmpdir(), 'te-lac-gitfail-'))
    mkdirSync(join(tempRoot, '.git'))
    wsCtl.root = tempRoot
    expect(await invokeListAgentCommits()).toEqual({ ok: false, reason: 'git-failed' })
  })

  it('enumerates agent groups against the MAIN-resolved root (request carries nothing)', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'te-lac-repo-'))
    initGitRepo(tempRoot)
    writeFileSync(join(tempRoot, 'a.txt'), 'agent write\n')
    execFileSync('git', ['add', '--', 'a.txt'], { cwd: tempRoot, stdio: 'ignore' })
    execFileSync(
      'git',
      [
        'commit',
        '--no-verify',
        '-m',
        'feat: agent change',
        '-m',
        'Machina-Agent: test-fixer\nMachina-Session: th-00000001'
      ],
      { cwd: tempRoot, stdio: 'ignore' }
    )
    wsCtl.root = tempRoot

    const result = await invokeListAgentCommits()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.agents).toHaveLength(1)
      expect(result.agents[0].agentId).toBe('test-fixer')
      expect(result.agents[0].shas).toHaveLength(1)
      expect(result.agents[0].lastSubject).toBe('feat: agent change')
    }
  })
})
