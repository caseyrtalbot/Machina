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

  it('passes wrapper script path as shell command', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('agent-wrapper.sh')
    expect(shellArg).toContain('--session-id')
    // Args are now shell-escaped (single-quoted)
    expect(shellArg).toContain("--vault-root '/vault/root'")
    expect(shellArg).toContain("--cwd '/projects/my-app'")
  })

  it('includes --prompt in shell command when prompt is provided', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = {
      cwd: '/projects/my-app',
      prompt: 'Fix the failing tests'
    }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).toContain('--prompt')
    expect(shellArg).toContain('Fix the failing tests')
  })

  it('omits --prompt from shell command when prompt is not provided', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    expect(shellArg).not.toContain('--prompt')
  })

  it('sets label with agent: prefix for terminal tab', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const labelArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][4]
    expect(labelArg).toMatch(/^agent:/)
    // Label should include the first 8 chars of the session ID
    expect(labelArg).toHaveLength('agent:'.length + 8)
  })

  it('uses dev path for wrapper when not in asar bundle', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    // In test/dev, __dirname does NOT contain .asar, so uses relative path from out/main/
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
