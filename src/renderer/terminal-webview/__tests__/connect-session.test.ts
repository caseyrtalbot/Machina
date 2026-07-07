// @vitest-environment node
/**
 * Webview-layer no-respawn enforcement (workstation Phase 2 step 4,
 * contracts §4). Load-bearing assertions in the style of Phase-1 step 4's
 * no-kill-on-detach tests: with `reattachOnly` set, terminal:create is NEVER
 * called — a dead agent PTY reports 'dead' instead of respawning a fresh
 * unattributed shell in the thread's cwd.
 */
import { describe, it, expect, vi } from 'vitest'
import { connectToSession, type ConnectSessionApi } from '../connect-session'

function fakeApi(overrides: Partial<ConnectSessionApi> = {}): {
  reconnect: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
} {
  return {
    reconnect: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue('sess-created'),
    ...overrides
  } as never
}

const base = {
  cwd: '/repo',
  label: null,
  vaultPath: '/repo',
  cols: 80,
  rows: 24
}

describe('reattachOnly (agent projection)', () => {
  it('NEVER calls terminal:create when the session is stale/dead — reports dead', async () => {
    const api = fakeApi() // reconnect → null: the PTY is gone
    const outcome = await connectToSession(
      { ...base, sessionId: 'sess-stale', reattachOnly: true },
      api
    )
    expect(outcome).toEqual({ kind: 'dead', sessionId: 'sess-stale' })
    expect(api.create).not.toHaveBeenCalled()
  })

  it('NEVER calls terminal:create when no sessionId was given at all', async () => {
    const api = fakeApi()
    const outcome = await connectToSession({ ...base, sessionId: null, reattachOnly: true }, api)
    expect(outcome).toEqual({ kind: 'dead', sessionId: null })
    expect(api.reconnect).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('reattaches to a surviving PTY and replays the ring buffer', async () => {
    const api = fakeApi({
      reconnect: vi.fn().mockResolvedValue({ scrollback: 'previous turn output' })
    } as never)
    const outcome = await connectToSession(
      { ...base, sessionId: 'sess-live', reattachOnly: true },
      api
    )
    expect(outcome).toEqual({
      kind: 'reconnected',
      sessionId: 'sess-live',
      scrollback: 'previous turn output'
    })
    expect(api.create).not.toHaveBeenCalled()
  })
})

describe('plain terminals (reattachOnly off) keep the stale-session respawn', () => {
  it('falls through to terminal:create at cwd when reconnect returns null', async () => {
    const api = fakeApi()
    const outcome = await connectToSession(
      { ...base, sessionId: 'sess-stale', reattachOnly: false },
      api
    )
    expect(outcome).toEqual({ kind: 'created', sessionId: 'sess-created' })
    expect(api.create).toHaveBeenCalledWith({
      cwd: '/repo',
      cols: 80,
      rows: 24,
      label: undefined,
      vaultPath: '/repo'
    })
  })

  it('creates fresh at / when no sessionId and no cwd are given', async () => {
    const api = fakeApi()
    const outcome = await connectToSession(
      {
        sessionId: null,
        reattachOnly: false,
        cwd: null,
        label: null,
        vaultPath: null,
        cols: 80,
        rows: 24
      },
      api
    )
    expect(outcome.kind).toBe('created')
    expect(api.create).toHaveBeenCalledWith({
      cwd: '/',
      cols: 80,
      rows: 24,
      label: undefined,
      vaultPath: undefined
    })
  })

  it('prefers reconnect over create when the session survives', async () => {
    const api = fakeApi({
      reconnect: vi.fn().mockResolvedValue({ scrollback: '' })
    } as never)
    const outcome = await connectToSession(
      { ...base, sessionId: 'sess-live', reattachOnly: false },
      api
    )
    expect(outcome.kind).toBe('reconnected')
    expect(api.create).not.toHaveBeenCalled()
  })
})
