// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ShellService } from '../../src/main/services/shell-service'
import type { AgentSpawnRequest } from '../../src/shared/agent-types'
import type { SessionId } from '../../src/shared/types'

// Mock crypto.randomUUID for deterministic session IDs
const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    randomUUID: () => MOCK_UUID
  }
})

// Mock fs writes (prompt temp file). readFileSync/existsSync delegate to real
// fs so the bundled default-agent-prompt.md lookup still works.
const writeFileSyncMock = vi.fn()
const mkdirSyncMock = vi.fn()
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
    mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
  }
})

// Mock vault-git so auto-commit is a no-op in tests
const commitPreAgentSnapshotMock = vi.fn().mockReturnValue({
  committed: false,
  reason: 'not-a-git-repo'
})
vi.mock('../../src/main/services/vault-git', () => ({
  commitPreAgentSnapshot: (...args: unknown[]) => commitPreAgentSnapshotMock(...args),
  isGitRepo: vi.fn().mockReturnValue(false),
  isAutoCommitOptedOut: vi.fn().mockReturnValue(false)
}))

function createMockShellService(): ShellService {
  return {
    create: vi.fn().mockReturnValue(MOCK_UUID as SessionId),
    tmuxAvailable: true,
    setCallbacks: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    shutdown: vi.fn(),
    killAll: vi.fn(),
    reconnect: vi.fn(),
    discover: vi.fn(),
    getProcessName: vi.fn()
  } as unknown as ShellService
}

describe('AgentSpawner', () => {
  let mockShellService: ShellService

  beforeEach(() => {
    vi.clearAllMocks()
    mockShellService = createMockShellService()
  })

  it('calls shellService.create when spawning', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    expect(mockShellService.create).toHaveBeenCalledOnce()
  })

  it('returns a SessionId from spawn', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    const result = spawner.spawn(request)

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('passes wrapper script path and shell-escaped args', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('agent-wrapper.sh')
    expect(shellArg).toContain('--session-id')
    expect(shellArg).toContain("--vault-root '/vault/root'")
    expect(shellArg).toContain("--cwd '/projects/my-app'")
  })

  it('writes prompt to a temp file and passes --prompt-file when user prompt is provided', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = {
      cwd: '/projects/my-app',
      prompt: 'Fix the failing tests'
    }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('--prompt-file')
    // Prompt text itself is no longer inlined into the shell command — it's in the temp file
    expect(shellArg).not.toContain('Fix the failing tests')

    // The prompt file should have been written under <TE_DIR>/agents/prompts/
    expect(writeFileSyncMock).toHaveBeenCalledOnce()
    const [writtenPath, writtenContent] = writeFileSyncMock.mock.calls[0]
    expect(writtenPath).toMatch(/[\\/]agents[\\/]prompts[\\/].*\.txt$/)
    expect(writtenContent).toContain('Fix the failing tests')
  })

  it('writes bundled default prompt to file even when no user prompt is provided', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('--prompt-file')

    // Bundled default prompt is written to the temp file
    expect(writeFileSyncMock).toHaveBeenCalledOnce()
    const [, writtenContent] = writeFileSyncMock.mock.calls[0]
    expect(writtenContent).toContain('Output Contract')
  })

  it('attempts a pre-agent git snapshot', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    expect(commitPreAgentSnapshotMock).toHaveBeenCalledOnce()
    const [vaultRoot, sessionId] = commitPreAgentSnapshotMock.mock.calls[0]
    expect(vaultRoot).toBe('/vault/root')
    expect(typeof sessionId).toBe('string')
  })

  it('sets label with agent: prefix for terminal tab', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const labelArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][4]
    expect(labelArg).toMatch(/^agent:/)
    expect(labelArg).toHaveLength('agent:'.length + 8)
  })

  it('uses dev path for wrapper when not in asar bundle', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('scripts/agent-wrapper.sh')
    expect(shellArg).not.toContain('resourcesPath')
  })

  it('passes vaultRoot as vaultPath to shellService.create', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const vaultPathArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][5]
    expect(vaultPathArg).toBe('/vault/root')
  })
})
