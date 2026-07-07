// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { CliThreadSpawner, isCliAgentIdentity, specIdForIdentity } from '../cli-thread-spawner'
import { CliAgentThreadBridge } from '../cli-agent-thread-bridge'

interface FakePtyService {
  writeAgentInput: ReturnType<typeof vi.fn>
  getActiveSessions: ReturnType<typeof vi.fn>
}

interface FakeShellService {
  create: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  getPtyService: () => FakePtyService
}

function fakeServices(): { shell: FakeShellService; pty: FakePtyService } {
  const pty: FakePtyService = {
    writeAgentInput: vi.fn(),
    getActiveSessions: vi.fn().mockReturnValue(['sess-xyz'])
  }
  const shell: FakeShellService = {
    create: vi.fn().mockReturnValue('sess-xyz'),
    kill: vi.fn(),
    getPtyService: () => pty
  }
  return { shell, pty }
}

function installed(id: string, installed = true) {
  return {
    id,
    displayName: id,
    brandColor: '#000',
    installed,
    version: installed ? '1.0.0' : null,
    error: null
  }
}

const CLAUDE_BASE = 'claude --print --verbose --output-format stream-json'
const CODEX_FLAGS = '--json --skip-git-repo-check'

// NOTE (workstation Phase 2 step 1): the pure invocation formatting that used
// to be tested here (formatCliInvocation) moved to @shared/agent-adapters,
// where tests/shared/agent-adapters.test.ts pins the golden byte-exact
// invocation table. The spawner tests below still assert the exact command
// strings written to the PTY, so the delegation itself stays regression-locked.

describe('specIdForIdentity', () => {
  it('strips the cli- prefix to match the registry id', () => {
    expect(specIdForIdentity('cli-claude')).toBe('claude')
    expect(specIdForIdentity('cli-codex')).toBe('codex')
    expect(specIdForIdentity('cli-gemini')).toBe('gemini')
    expect(specIdForIdentity('cli-raw')).toBe('raw')
  })
})

describe('CliThreadSpawner', () => {
  it('returns ok=false with a binary-missing hint when the CLI is not installed', async () => {
    const { shell } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude', false)]
    })
    const result = await spawner.spawn('thread-A', 'cli-claude', '/v')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not installed/i)
    expect(shell.create).not.toHaveBeenCalled()
  })

  it('creates a PTY, binds the bridge, and stores the session when installed', async () => {
    const { shell } = fakeServices()
    const bindSpy = vi.fn()
    const bridge = {
      bind: bindSpy,
      observe: () => {},
      closeSession: () => {}
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    const result = await spawner.spawn('thread-A', 'cli-claude', '/v')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.sessionId).toBe('sess-xyz')
    expect(shell.create).toHaveBeenCalledWith('/v', undefined, undefined, undefined, 'cli-claude')
    expect(bindSpy).toHaveBeenCalledWith('sess-xyz', 'thread-A')
    expect(spawner.getSessionId('thread-A')).toBe('sess-xyz')
  })

  it('writes a one-shot invocation through writeAgentInput on user message', async () => {
    const { shell, pty } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    const ok = spawner.sendUserMessage('thread-A', 'cli-claude', 'list files')
    expect(ok).toBe(true)
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} 'list files'\r`,
      'batched'
    )
  })

  it('returns false from sendUserMessage when no session is bound for the thread', () => {
    const { shell } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({ shellService: shell as never, bridge })
    expect(spawner.sendUserMessage('absent', 'cli-claude', 'x')).toBe(false)
  })

  it('input respawns on demand when no session is bound (post-relaunch dead thread)', async () => {
    const { shell, pty } = fakeServices()
    const bindSpy = vi.fn()
    const bridge = {
      bind: bindSpy,
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    // No prior spawn: simulates a persisted thread after app relaunch.
    const res = await spawner.input('thread-A', 'cli-claude', 'list files', '/v')
    expect(res.ok).toBe(true)
    expect(shell.create).toHaveBeenCalledTimes(1)
    expect(bindSpy).toHaveBeenCalledWith('sess-xyz', 'thread-A')
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} 'list files'\r`,
      'batched'
    )
  })

  it('input respawns when the bound PTY has exited (stale session)', async () => {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    // The PTY died: it no longer appears in the active session list.
    pty.getActiveSessions.mockReturnValue([])
    shell.create.mockReturnValue('sess-new')
    const res = await spawner.input('thread-A', 'cli-claude', 'retry', '/v')
    expect(res.ok).toBe(true)
    expect(shell.create).toHaveBeenCalledTimes(2)
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-new',
      `${CLAUDE_BASE} 'retry'\r`,
      'batched'
    )
  })

  it('input reuses the live session without respawning', async () => {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    const res = await spawner.input('thread-A', 'cli-claude', 'hi', '/v')
    expect(res.ok).toBe(true)
    expect(shell.create).toHaveBeenCalledTimes(1)
    expect(pty.writeAgentInput).toHaveBeenCalledWith('sess-xyz', `${CLAUDE_BASE} 'hi'\r`, 'batched')
  })

  it('input returns ok=false when the respawn fails (CLI not installed)', async () => {
    const { shell, pty } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude', false)]
    })
    const res = await spawner.input('thread-A', 'cli-claude', 'hello', '/v')
    expect(res.ok).toBe(false)
    expect(shell.create).not.toHaveBeenCalled()
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })

  it('kills the PTY and forgets the binding on close', async () => {
    const { shell } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    spawner.close('thread-A')
    expect(shell.kill).toHaveBeenCalledWith('sess-xyz')
    expect(spawner.getSessionId('thread-A')).toBeUndefined()
  })
})

describe('CliThreadSpawner turn registry (workstation step 3)', () => {
  function fakeRegistry() {
    return {
      turnStarted: vi.fn((_opts: { threadId: string; agentId: string; cwd: string }) => undefined),
      threadClosed: vi.fn((_threadId: string) => undefined)
    }
  }

  function registryBridge(): CliAgentThreadBridge {
    return {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
  }

  it('input on a dead thread spawns, then opens the turn window with the default agentId', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    const res = await spawner.input('thread-A', 'cli-claude', 'list files', '/v')
    expect(res.ok).toBe(true)
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(registry.turnStarted).toHaveBeenCalledWith({
      threadId: 'thread-A',
      agentId: 'cli-claude',
      cwd: '/v',
      attributionSuspect: false
    })
  })

  it('input with an explicit agentId opens the turn window under that harness slug', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    const res = await spawner.input('thread-A', 'cli-claude', 'fix tests', '/v', 'test-fixer')
    expect(res.ok).toBe(true)
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(registry.turnStarted).toHaveBeenCalledWith({
      threadId: 'thread-A',
      agentId: 'test-fixer',
      cwd: '/v',
      attributionSuspect: false
    })
  })

  it('agentId persists per thread: the next input without one still uses the stored slug', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    await spawner.input('thread-A', 'cli-claude', 'first', '/v', 'test-fixer')
    await spawner.input('thread-A', 'cli-claude', 'second', '/v')
    expect(registry.turnStarted).toHaveBeenCalledTimes(2)
    expect(registry.turnStarted).toHaveBeenLastCalledWith({
      threadId: 'thread-A',
      agentId: 'test-fixer',
      cwd: '/v',
      attributionSuspect: false
    })
  })

  it('opens the turn window BEFORE the PTY write (turnStarted precedes writeAgentInput)', async () => {
    const { shell, pty } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    await spawner.input('thread-A', 'cli-claude', 'go', '/v')
    expect(registry.turnStarted).toHaveBeenCalledTimes(1)
    expect(pty.writeAgentInput).toHaveBeenCalledTimes(1)
    const turnOrder = registry.turnStarted.mock.invocationCallOrder[0]
    const writeOrder = pty.writeAgentInput.mock.invocationCallOrder[0]
    expect(turnOrder).toBeLessThan(writeOrder)
  })

  it('close() drops the turn window via registry.threadClosed', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    spawner.close('thread-A')
    expect(registry.threadClosed).toHaveBeenCalledTimes(1)
    expect(registry.threadClosed).toHaveBeenCalledWith('thread-A')
  })

  it('the suspect tag from a degraded resolution reaches turnStarted', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    // Degraded resolution at the IPC boundary: agentId undefined + suspect.
    const res = await spawner.input(
      'thread-A',
      'cli-claude',
      'go',
      '/v',
      undefined,
      undefined,
      true
    )
    expect(res.ok).toBe(true)
    expect(registry.turnStarted).toHaveBeenCalledWith({
      threadId: 'thread-A',
      agentId: 'cli-claude',
      cwd: '/v',
      attributionSuspect: true
    })
  })

  it('a degraded resolution clears a stale slug; a later clean turn stays on adapter identity', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    // Turn 1: validated slug. Turn 2: validation degraded (undefined+suspect)
    // — the stored slug must NOT survive as the attribution. Turn 3: clean
    // ad-hoc absent field — the slug stays cleared and the tag drops.
    await spawner.input('thread-A', 'cli-claude', 'first', '/v', 'test-fixer')
    await spawner.input('thread-A', 'cli-claude', 'second', '/v', undefined, undefined, true)
    expect(registry.turnStarted).toHaveBeenLastCalledWith({
      threadId: 'thread-A',
      agentId: 'cli-claude',
      cwd: '/v',
      attributionSuspect: true
    })
    await spawner.input('thread-A', 'cli-claude', 'third', '/v')
    expect(registry.turnStarted).toHaveBeenLastCalledWith({
      threadId: 'thread-A',
      agentId: 'cli-claude',
      cwd: '/v',
      attributionSuspect: false
    })
  })

  it('an absent agentId WITHOUT the suspect tag keeps a slug bound earlier in-session', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    await spawner.input('thread-A', 'cli-claude', 'first', '/v', 'test-fixer')
    await spawner.input('thread-A', 'cli-claude', 'second', '/v', undefined, undefined, false)
    expect(registry.turnStarted).toHaveBeenLastCalledWith({
      threadId: 'thread-A',
      agentId: 'test-fixer',
      cwd: '/v',
      attributionSuspect: false
    })
  })

  it('a suspect tag passed to spawn flows into the next sendUserMessage turn window', async () => {
    const { shell } = fakeServices()
    const registry = fakeRegistry()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')],
      registry
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v', undefined, undefined, true)
    spawner.sendUserMessage('thread-A', 'cli-claude', 'go')
    expect(registry.turnStarted).toHaveBeenCalledWith({
      threadId: 'thread-A',
      agentId: 'cli-claude',
      cwd: '/v',
      attributionSuspect: true
    })
  })

  it('a spawner without a registry option still sends and closes without throwing', async () => {
    const { shell, pty } = fakeServices()
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge: registryBridge(),
      detect: async () => [installed('claude')]
    })
    const res = await spawner.input('thread-A', 'cli-claude', 'hello', '/v')
    expect(res.ok).toBe(true)
    expect(pty.writeAgentInput).toHaveBeenCalledTimes(1)
    expect(() => spawner.close('thread-A')).not.toThrow()
    expect(shell.kill).toHaveBeenCalledWith('sess-xyz')
  })
})

describe('CliThreadSpawner adapter delegation (workstation Phase 2 step 1)', () => {
  it('resumes claude via the adapter when the bridge captured a session id', async () => {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => '206caf50-df65-4a64-adf2-0749f4637bf7'
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    spawner.sendUserMessage('thread-A', 'cli-claude', 'go on')
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} --resume 206caf50-df65-4a64-adf2-0749f4637bf7 'go on'\r`,
      'batched'
    )
  })

  it('falls back to codex resume --last after a first turn with no captured id', async () => {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('codex')]
    })
    await spawner.input('thread-A', 'cli-codex', 'first', '/v')
    await spawner.input('thread-A', 'cli-codex', 'second', '/v')
    expect(pty.writeAgentInput).toHaveBeenLastCalledWith(
      'sess-xyz',
      `codex exec resume ${CODEX_FLAGS} --last 'second'\r`,
      'batched'
    )
  })

  it('throws on a non-CLI agent identity when a session is somehow bound', async () => {
    const { shell } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    expect(() => spawner.sendUserMessage('thread-A', 'machina-native', 'x')).toThrow(/cli/i)
  })
})

describe('CliThreadSpawner model threading (workstation Phase 2 step 1)', () => {
  function modelSpawner() {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude'), installed('codex')]
    })
    return { spawner, pty }
  }

  it('a model passed to spawn flows into the next invocation as --model', async () => {
    const { spawner, pty } = modelSpawner()
    await spawner.spawn('thread-A', 'cli-claude', '/v', undefined, 'sonnet')
    spawner.sendUserMessage('thread-A', 'cli-claude', 'list files')
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} --model sonnet 'list files'\r`,
      'batched'
    )
  })

  it('a model passed to input flows into the codex invocation as -m', async () => {
    const { spawner, pty } = modelSpawner()
    await spawner.input('thread-A', 'cli-codex', 'list files', '/v', undefined, 'gpt-5.5')
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `codex exec --json --skip-git-repo-check -m gpt-5.5 'list files'\r`,
      'batched'
    )
  })

  it('undefined model (the filler/invalid resolution) emits NO flag', async () => {
    const { spawner, pty } = modelSpawner()
    await spawner.input('thread-A', 'cli-claude', 'list files', '/v', undefined, undefined)
    expect(pty.writeAgentInput).toHaveBeenCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} 'list files'\r`,
      'batched'
    )
  })

  it('a later input without a model clears the stored pick (back to adapter default)', async () => {
    const { spawner, pty } = modelSpawner()
    await spawner.input('thread-A', 'cli-claude', 'first', '/v', undefined, 'sonnet')
    await spawner.input('thread-A', 'cli-claude', 'second', '/v')
    expect(pty.writeAgentInput).toHaveBeenLastCalledWith(
      'sess-xyz',
      `${CLAUDE_BASE} --continue 'second'\r`,
      'batched'
    )
  })
})

describe('CliThreadSpawner raw adapter (workstation Phase 2 step 1)', () => {
  it('spawn skips the installed-binary check for cli-raw (nothing to probe)', async () => {
    const { shell } = fakeServices()
    const detect = vi.fn(async () => [])
    const bindSpy = vi.fn()
    const bridge = { bind: bindSpy } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({ shellService: shell as never, bridge, detect })
    const result = await spawner.spawn('thread-R', 'cli-raw', '/v')
    expect(result.ok).toBe(true)
    expect(detect).not.toHaveBeenCalled()
    expect(shell.create).toHaveBeenCalledWith('/v', undefined, undefined, undefined, 'cli-raw')
    expect(bindSpy).toHaveBeenCalledWith('sess-xyz', 'thread-R')
  })

  it('sendUserMessage refuses on cli-raw: no template source exists in step 1', async () => {
    // Writing a formatted invocation is impossible (the raw adapter throws
    // without an invocationTemplate) and writing anything else would run a
    // broken command as the user — so the spawner returns false and nothing
    // reaches the PTY or the turn registry.
    const { shell, pty } = fakeServices()
    const registry = {
      turnStarted: vi.fn(),
      threadClosed: vi.fn()
    }
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [],
      registry
    })
    await spawner.spawn('thread-R', 'cli-raw', '/v')
    expect(spawner.sendUserMessage('thread-R', 'cli-raw', 'hello')).toBe(false)
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
    expect(registry.turnStarted).not.toHaveBeenCalled()
  })

  it('input on a raw thread spawns the PTY but reports ok=false (send is disabled)', async () => {
    const { shell, pty } = fakeServices()
    const bridge = {
      bind: vi.fn(),
      getAgentSessionId: () => undefined
    } as unknown as CliAgentThreadBridge
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => []
    })
    const res = await spawner.input('thread-R', 'cli-raw', 'hello', '/v')
    expect(res.ok).toBe(false)
    expect(shell.create).toHaveBeenCalledTimes(1)
    expect(pty.writeAgentInput).not.toHaveBeenCalled()
  })
})

describe('isCliAgentIdentity', () => {
  it('accepts the four CLI agent identities', () => {
    expect(isCliAgentIdentity('cli-claude')).toBe(true)
    expect(isCliAgentIdentity('cli-codex')).toBe(true)
    expect(isCliAgentIdentity('cli-gemini')).toBe(true)
    expect(isCliAgentIdentity('cli-raw')).toBe(true)
  })

  it('rejects machina-native', () => {
    expect(isCliAgentIdentity('machina-native')).toBe(false)
  })

  it('rejects junk', () => {
    expect(isCliAgentIdentity('claude')).toBe(false)
    expect(isCliAgentIdentity('')).toBe(false)
  })
})
