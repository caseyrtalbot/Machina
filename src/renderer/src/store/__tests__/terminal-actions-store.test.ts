import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useTerminalActionStore } from '../terminal-actions-store'

describe('useTerminalActionStore', () => {
  beforeEach(() => {
    useTerminalActionStore.getState().reset()
  })

  it('starts with no pending request and null handler', () => {
    const state = useTerminalActionStore.getState()

    expect(state.pendingActivation).toBe(false)
    expect(state.activateClaude).toBeNull()
  })

  it('requestActivateClaude sets pending flag', () => {
    useTerminalActionStore.getState().requestActivateClaude()

    expect(useTerminalActionStore.getState().pendingActivation).toBe(true)
  })

  it('clearRequest clears the pending flag', () => {
    useTerminalActionStore.getState().requestActivateClaude()
    useTerminalActionStore.getState().clearRequest()

    expect(useTerminalActionStore.getState().pendingActivation).toBe(false)
  })

  it('setHandler registers the activateClaude handler', () => {
    const handler = vi.fn()

    useTerminalActionStore.getState().setHandler(handler)

    expect(useTerminalActionStore.getState().activateClaude).toBe(handler)
  })

  it('reset clears both handler and pending flag', () => {
    useTerminalActionStore.getState().setHandler(vi.fn())
    useTerminalActionStore.getState().requestActivateClaude()
    useTerminalActionStore.getState().reset()

    const state = useTerminalActionStore.getState()
    expect(state.activateClaude).toBeNull()
    expect(state.pendingActivation).toBe(false)
  })

  it('calling the handler directly works when registered', async () => {
    const handler = vi.fn()
    useTerminalActionStore.getState().setHandler(handler)

    const { activateClaude } = useTerminalActionStore.getState()
    activateClaude?.()

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('requestActivateClaude calls handler immediately if already registered', () => {
    const handler = vi.fn()
    useTerminalActionStore.getState().setHandler(handler)

    useTerminalActionStore.getState().requestActivateClaude()

    // Handler called immediately, no pending flag needed
    expect(handler).toHaveBeenCalledTimes(1)
    expect(useTerminalActionStore.getState().pendingActivation).toBe(false)
  })

  it('requestActivateClaude sets pending when handler is not registered', () => {
    useTerminalActionStore.getState().requestActivateClaude()

    // No handler, so flag stays pending
    expect(useTerminalActionStore.getState().pendingActivation).toBe(true)
  })
})
