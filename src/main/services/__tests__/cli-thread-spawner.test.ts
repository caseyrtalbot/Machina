// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  CliThreadSpawner,
  formatCliInvocation,
  isCliAgentIdentity,
  specIdForIdentity
} from '../cli-thread-spawner'
import { CliAgentThreadBridge } from '../cli-agent-thread-bridge'
import { commitPreAgentSnapshot } from '../vault-git'

vi.mock('../vault-git', () => ({
  commitPreAgentSnapshot: vi.fn().mockReturnValue({ committed: false, reason: 'not-a-git-repo' })
}))

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

describe('formatCliInvocation', () => {
  it('formats a first-turn claude invocation with structured output flags', () => {
    expect(formatCliInvocation('cli-claude', 'list files')).toBe(`${CLAUDE_BASE} 'list files'`)
  })

  it('formats a first-turn codex invocation with JSONL output', () => {
    expect(formatCliInvocation('cli-codex', 'list files')).toBe(
      `codex exec ${CODEX_FLAGS} 'list files'`
    )
  })

  it('formats a gemini one-shot invocation (no structured mode)', () => {
    expect(formatCliInvocation('cli-gemini', 'list files')).toBe(`gemini -p 'list files'`)
  })

  it('resumes claude by captured session id on later turns', () => {
    expect(
      formatCliInvocation('cli-claude', 'go on', {
        resumeSessionId: '206caf50-df65-4a64-adf2-0749f4637bf7',
        continueConversation: true
      })
    ).toBe(`${CLAUDE_BASE} --resume 206caf50-df65-4a64-adf2-0749f4637bf7 'go on'`)
  })

  it('falls back to claude --continue when no session id was captured', () => {
    expect(formatCliInvocation('cli-claude', 'go on', { continueConversation: true })).toBe(
      `${CLAUDE_BASE} --continue 'go on'`
    )
  })

  it('resumes codex by captured thread id on later turns', () => {
    expect(
      formatCliInvocation('cli-codex', 'go on', {
        resumeSessionId: '019eb1da-decb-7052-a145-1ac71e4bc80b',
        continueConversation: true
      })
    ).toBe(`codex exec resume ${CODEX_FLAGS} 019eb1da-decb-7052-a145-1ac71e4bc80b 'go on'`)
  })

  it('falls back to codex resume --last when no thread id was captured', () => {
    expect(formatCliInvocation('cli-codex', 'go on', { continueConversation: true })).toBe(
      `codex exec resume ${CODEX_FLAGS} --last 'go on'`
    )
  })

  it('gemini ignores continuity options (gated per agent)', () => {
    expect(
      formatCliInvocation('cli-gemini', 'go on', {
        resumeSessionId: '019eb1da-decb-7052-a145-1ac71e4bc80b',
        continueConversation: true
      })
    ).toBe(`gemini -p 'go on'`)
  })

  it('rejects a shell-unsafe resume id and falls back to --continue', () => {
    expect(
      formatCliInvocation('cli-claude', 'x', {
        resumeSessionId: `abc; rm -rf /'`,
        continueConversation: true
      })
    ).toBe(`${CLAUDE_BASE} --continue 'x'`)
  })

  it('escapes embedded single quotes safely', () => {
    expect(formatCliInvocation('cli-claude', "what's up")).toBe(`${CLAUDE_BASE} 'what'\\''s up'`)
  })

  it('preserves multi-line prompts inside the quoted argument', () => {
    expect(formatCliInvocation('cli-claude', 'line 1\nline 2')).toBe(
      `${CLAUDE_BASE} 'line 1\nline 2'`
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

  it('snapshots the vault at the top of spawn for agent rollback', async () => {
    const { shell } = fakeServices()
    const bridge = new CliAgentThreadBridge({ onMessage: () => {} })
    const spawner = new CliThreadSpawner({
      shellService: shell as never,
      bridge,
      detect: async () => [installed('claude')]
    })
    vi.mocked(commitPreAgentSnapshot).mockClear()
    await spawner.spawn('thread-A', 'cli-claude', '/v')
    expect(commitPreAgentSnapshot).toHaveBeenCalledWith('/v', 'thread-A')
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
