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

// Mock child_process.spawn for spawnLibrarian tests
const mockChildProcess = vi.hoisted(() => ({
  spawned: null as unknown,
  onHandlers: {} as Record<string, (...args: unknown[]) => void>
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = {
        pid: 99999,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          mockChildProcess.onHandlers[event] = handler
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() }
      }
      mockChildProcess.spawned = child
      return child
    })
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

  it('sends agent prompt template even when no user prompt is provided', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')
    const request: AgentSpawnRequest = { cwd: '/projects/my-app' }

    spawner.spawn(request)

    const shellArg = (mockShellService.create as ReturnType<typeof vi.fn>).mock.calls[0][3]
    // When the bundled default-agent-prompt.md exists, it gets sent as the prompt
    expect(shellArg).toContain('--prompt')
    expect(shellArg).toContain('Output Contract')
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

describe('AgentSpawner.spawnLibrarian', () => {
  let mockShellService: ShellService

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockShellService = createMockShellService()
    mockChildProcess.spawned = null
    mockChildProcess.onHandlers = {}
  })

  it('spawns claude CLI as a child process', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    expect(spawn).toHaveBeenCalledOnce()
    const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[0]).toBe('claude')
    expect(args[2].cwd).toBe('/vault/root')
  })

  it('passes system prompt via --system-prompt flag', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    const cliArgs: string[] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(cliArgs).toContain('--system-prompt')
  })

  it('includes --allowedTools with file tools', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const { spawn } = await import('child_process')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    const cliArgs: string[] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(cliArgs).toContain('--allowedTools')
    const toolsIdx = cliArgs.indexOf('--allowedTools')
    const toolsArg = cliArgs[toolsIdx + 1]
    expect(toolsArg).toContain('Read')
    expect(toolsArg).toContain('Write')
    expect(toolsArg).toContain('Edit')
    expect(toolsArg).toContain('Glob')
    expect(toolsArg).toContain('Grep')
  })

  it('returns a session ID and registers with the monitor', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    const result = spawner.spawnLibrarian('/vault/root')
    expect(result.sessionId).toBeTruthy()
    expect(typeof result.sessionId).toBe('string')
  })

  it('does not call shellService.create', async () => {
    const { AgentSpawner } = await import('../../src/main/services/agent-spawner')
    const spawner = new AgentSpawner(mockShellService, '/vault/root')

    spawner.spawnLibrarian('/vault/root')

    expect(mockShellService.create).not.toHaveBeenCalled()
  })
})
