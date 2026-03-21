import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useWorkbenchActionStore } from '../workbench-actions-store'

describe('useWorkbenchActionStore', () => {
  beforeEach(() => {
    useWorkbenchActionStore.getState().reset()
  })

  it('starts with all action handlers null and counts at zero', () => {
    const state = useWorkbenchActionStore.getState()

    expect(state.refresh).toBeNull()
    expect(state.fitAll).toBeNull()
    expect(state.addTerminal).toBeNull()
    expect(state.createTension).toBeNull()
    expect(state.savePattern).toBeNull()
    expect(state.endSession).toBeNull()
    expect(state.toggleThread).toBeNull()
    expect(state.selectedNodeCount).toBe(0)
    expect(state.milestoneCount).toBe(0)
    expect(state.isLive).toBe(false)
    expect(state.threadOpen).toBe(false)
  })

  it('setRegistration replaces all action handlers and metadata', () => {
    const refresh = vi.fn()
    const fitAll = vi.fn()

    useWorkbenchActionStore.getState().setRegistration({
      refresh,
      fitAll,
      addTerminal: null,
      createTension: null,
      savePattern: null,
      endSession: null,
      toggleThread: null,
      selectedNodeCount: 3,
      milestoneCount: 5,
      isLive: true,
      threadOpen: true
    })

    const state = useWorkbenchActionStore.getState()
    expect(state.refresh).toBe(refresh)
    expect(state.fitAll).toBe(fitAll)
    expect(state.selectedNodeCount).toBe(3)
    expect(state.milestoneCount).toBe(5)
    expect(state.isLive).toBe(true)
    expect(state.threadOpen).toBe(true)
  })

  it('reset clears all handlers back to empty', () => {
    useWorkbenchActionStore.getState().setRegistration({
      refresh: vi.fn(),
      fitAll: vi.fn(),
      addTerminal: vi.fn(),
      createTension: vi.fn(),
      savePattern: vi.fn(),
      endSession: vi.fn(),
      toggleThread: vi.fn(),
      selectedNodeCount: 2,
      milestoneCount: 7,
      isLive: true,
      threadOpen: true
    })

    useWorkbenchActionStore.getState().reset()

    const state = useWorkbenchActionStore.getState()
    expect(state.refresh).toBeNull()
    expect(state.selectedNodeCount).toBe(0)
    expect(state.isLive).toBe(false)
  })
})
