import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphSettingsStore } from '../../src/renderer/src/store/graph-settings-store'

beforeEach(() => {
  useGraphSettingsStore.setState(useGraphSettingsStore.getInitialState())
})

describe('graph-settings-store', () => {
  it('has sensible defaults', () => {
    const state = useGraphSettingsStore.getState()
    expect(state.showOrphans).toBe(true)
    expect(state.baseNodeSize).toBe(4)
    expect(state.centerForce).toBe(0.5)
    expect(state.repelForce).toBe(-120)
    expect(state.isAnimating).toBe(true)
  })

  it('updates filter settings immutably', () => {
    useGraphSettingsStore.getState().setShowOrphans(false)
    expect(useGraphSettingsStore.getState().showOrphans).toBe(false)
  })

  it('updates force settings', () => {
    const { setCenterForce, setRepelForce } = useGraphSettingsStore.getState()
    setCenterForce(0.8)
    setRepelForce(-200)
    const state = useGraphSettingsStore.getState()
    expect(state.centerForce).toBe(0.8)
    expect(state.repelForce).toBe(-200)
  })

  it('updates display settings', () => {
    const { setBaseNodeSize, setLinkOpacity, setShowArrows } = useGraphSettingsStore.getState()
    setBaseNodeSize(8)
    setLinkOpacity(0.7)
    setShowArrows(true)
    const state = useGraphSettingsStore.getState()
    expect(state.baseNodeSize).toBe(8)
    expect(state.linkOpacity).toBe(0.7)
    expect(state.showArrows).toBe(true)
  })

  it('updates group visibility', () => {
    useGraphSettingsStore.getState().setGroupVisible('gene', false)
    expect(useGraphSettingsStore.getState().groups.gene.visible).toBe(false)
  })

  it('updates group color', () => {
    useGraphSettingsStore.getState().setGroupColor('gene', '#FF0000')
    expect(useGraphSettingsStore.getState().groups.gene.color).toBe('#FF0000')
  })

  it('does not mutate previous state on group update', () => {
    const before = useGraphSettingsStore.getState().groups
    useGraphSettingsStore.getState().setGroupVisible('gene', false)
    const after = useGraphSettingsStore.getState().groups
    expect(before).not.toBe(after)
    expect(before.gene).not.toBe(after.gene)
  })
})
