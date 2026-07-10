/**
 * agent-transport ↔ cli-session-store seam (workstation Phase 2 step 4):
 * the CLI transport must KEEP the sessionId the cli-thread:spawn response
 * returns (it used to drop it — the seam-map gap this step closes) and seed
 * the session store with it; thread close drops the binding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from '@shared/thread-types'

const spawn = vi.fn()
const input = vi.fn()
const close = vi.fn()
;(window as unknown as Record<string, unknown>).api = {
  cliThread: { spawn, input, close }
}

import { transportFor } from '../agent-transport'
import { useCliSessionStore } from '../cli-session-store'
import { useAgentDispatchStore } from '../agent-dispatch-store'

const cliThread: Thread = {
  id: 't-cli',
  agent: 'cli-claude',
  model: 'default',
  started: '2026-07-07T00:00:00Z',
  lastMessage: '2026-07-07T00:00:00Z',
  title: 'cli thread',
  dockState: { tabs: [] },
  messages: []
}

beforeEach(() => {
  useCliSessionStore.setState({ byThread: {} })
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cliTransport.start retains the spawn-response sessionId', () => {
  it('seeds the cli-session-store on a successful spawn', async () => {
    spawn.mockResolvedValue({ ok: true, sessionId: 'sess-spawned' })
    const result = await transportFor('cli-claude').start(cliThread, '/v')
    expect(result.status).toBe('accepted')
    expect(useCliSessionStore.getState().byThread['t-cli']).toEqual({
      sessionId: 'sess-spawned',
      live: true
    })
  })

  it('does not seed on a failed spawn', async () => {
    spawn.mockResolvedValue({ ok: false, error: 'not installed' })
    const result = await transportFor('cli-claude').start(cliThread, '/v')
    expect(result).toEqual({ status: 'refused', message: 'not installed' })
    expect(useCliSessionStore.getState().byThread['t-cli']).toBeUndefined()
  })

  it('reports an indeterminate, non-retryable state when spawn never resolves', async () => {
    vi.useFakeTimers()
    spawn.mockReturnValue(new Promise(() => {}))
    const pending = transportFor('cli-claude').start(cliThread, '/v')
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    expect(result).toEqual(
      expect.objectContaining({
        status: 'indeterminate',
        message: expect.stringMatching(/status is unknown.*do not create another thread/i)
      })
    )
    expect(useCliSessionStore.getState().byThread['t-cli']).toBeUndefined()
  })

  it('seeds the exact session when a timed-out spawn succeeds late', async () => {
    vi.useFakeTimers()
    let resolveSpawn:
      | ((value: { ok: true; sessionId: string } | { ok: false; error: string }) => void)
      | undefined
    spawn.mockReturnValue(
      new Promise((resolve) => {
        resolveSpawn = resolve
      })
    )
    const pending = transportFor('cli-claude').start(cliThread, '/v')
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    expect(result.status).toBe('indeterminate')
    if (result.status !== 'indeterminate') return

    resolveSpawn?.({ ok: true, sessionId: 'sess-late' })
    await expect(result.settlement).resolves.toMatchObject({ status: 'accepted' })
    expect(useCliSessionStore.getState().byThread['t-cli']).toEqual({
      sessionId: 'sess-late',
      live: true
    })
  })

  it('does not resurrect a deleted thread when a timed-out spawn succeeds late', async () => {
    vi.useFakeTimers()
    let resolveSpawn:
      | ((value: { ok: true; sessionId: string } | { ok: false; error: string }) => void)
      | undefined
    spawn.mockReturnValue(
      new Promise((resolve) => {
        resolveSpawn = resolve
      })
    )
    const pending = transportFor('cli-claude').start(cliThread, '/v')
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    expect(result.status).toBe('indeterminate')
    if (result.status !== 'indeterminate') return

    useAgentDispatchStore.getState().dropThreadRuntime(cliThread.id)
    useCliSessionStore.getState().drop(cliThread.id)
    resolveSpawn?.({ ok: true, sessionId: 'sess-after-delete' })
    await expect(result.settlement).resolves.toMatchObject({ status: 'accepted' })

    expect(useCliSessionStore.getState().byThread[cliThread.id]).toBeUndefined()
  })
})

describe('cliTransport.sendTurn bounds input acceptance', () => {
  it('returns a retryable refusal only when main explicitly refuses', async () => {
    input.mockResolvedValue({ ok: false })
    await expect(
      transportFor('cli-claude').sendTurn(cliThread, 'inspect this', {
        vaultPath: '/v',
        historyMessages: [],
        dockTabsSnapshot: []
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'refused' }))
  })

  it('keeps a timed-out input indeterminate even when the invoke resolves late', async () => {
    vi.useFakeTimers()
    let resolveInput: ((value: { ok: true }) => void) | undefined
    input.mockReturnValue(
      new Promise((resolve) => {
        resolveInput = resolve
      })
    )
    const pending = transportFor('cli-claude').sendTurn(cliThread, 'inspect this', {
      vaultPath: '/v',
      historyMessages: [],
      dockTabsSnapshot: []
    })
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    expect(result).toEqual(
      expect.objectContaining({
        status: 'indeterminate',
        message: expect.stringMatching(/may still execute.*do not retry/i)
      })
    )
    expect(result.status === 'indeterminate' ? result.message : '').toMatch(
      /Stop only sends an interrupt.*cannot cancel the pending delivery/i
    )
    resolveInput?.({ ok: true })
    await Promise.resolve()
    expect(result.status).toBe('indeterminate')
    expect(input).toHaveBeenCalledOnce()
  })
})

describe('cliTransport.close drops the binding', () => {
  it('removes the thread entry after close', async () => {
    close.mockResolvedValue(undefined)
    useCliSessionStore.getState().seed('t-cli', 'sess-spawned')
    await transportFor('cli-claude').close('t-cli')
    expect(close).toHaveBeenCalledWith('t-cli')
    expect(useCliSessionStore.getState().byThread['t-cli']).toBeUndefined()
  })
})
