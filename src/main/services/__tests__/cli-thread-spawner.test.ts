// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  CliThreadSpawner,
  formatCliInvocation,
  isCliAgentIdentity,
  specIdForIdentity
} from '../cli-thread-spawner'
import { CliAgentThreadBridge } from '../cli-agent-thread-bridge'

interface FakePtyService {
  writeAgentInput: ReturnType<typeof vi.fn>
}

interface FakeShellService {
  create: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  getPtyService: () => FakePtyService
}

function fakeServices(): { shell: FakeShellService; pty: FakePtyService } {
  const pty: FakePtyService = { writeAgentInput: vi.fn() }
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

describe('formatCliInvocation', () => {
  it('formats a claude one-shot invocation with single-quoted prompt', () => {
    expect(formatCliInvocation('cli-claude', 'list files')).toBe(`claude --print 'list files'`)
  })

  it('formats a codex one-shot invocation', () => {
    expect(formatCliInvocation('cli-codex', 'list files')).toBe(`codex exec 'list files'`)
  })

  it('formats a gemini one-shot invocation', () => {
    expect(formatCliInvocation('cli-gemini', 'list files')).toBe(`gemini -p 'list files'`)
  })

  it('escapes embedded single quotes safely', () => {
    expect(formatCliInvocation('cli-claude', "what's up")).toBe(`claude --print 'what'\\''s up'`)
  })

  it('preserves multi-line prompts inside the quoted argument', () => {
    expect(formatCliInvocation('cli-claude', 'line 1\nline 2')).toBe(
      `claude --print 'line 1\nline 2'`
    )
  })

  it('throws on a non-CLI agent identity', () => {
    expect(() => formatCliInvocation('machina-native', 'x')).toThrow(/cli/i)
  })
})

describe('specIdForIdentity', () => {
  it('strips the cli- prefix to match the registry id', () => {
    expect(specIdForIdentity('cli-claude')).toBe('claude')
    expect(specIdForIdentity('cli-codex')).toBe('codex')
    expect(specIdForIdentity('cli-gemini')).toBe('gemini')
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
      `claude --print 'list files'\r`,
      'batched'
    )
  })

  it('returns false from sendUserMessage when no session is bound for the thread', () => {
    const { shell } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({ shellService: shell as never, bridge })
    expect(spawner.sendUserMessage('absent', 'cli-claude', 'x')).toBe(false)
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

describe('isCliAgentIdentity', () => {
  it('accepts the three CLI agent identities', () => {
    expect(isCliAgentIdentity('cli-claude')).toBe(true)
    expect(isCliAgentIdentity('cli-codex')).toBe(true)
    expect(isCliAgentIdentity('cli-gemini')).toBe(true)
  })

  it('rejects machina-native', () => {
    expect(isCliAgentIdentity('machina-native')).toBe(false)
  })

  it('rejects junk', () => {
    expect(isCliAgentIdentity('claude')).toBe(false)
    expect(isCliAgentIdentity('')).toBe(false)
  })
})
