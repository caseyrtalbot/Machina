import { describe, it, expect, beforeEach } from 'vitest'
import {
  useGraphSettingsStore,
  matchGroupRule,
  resolveGroupColor
} from '../../src/renderer/src/store/graph-settings-store'

beforeEach(() => {
  useGraphSettingsStore.setState(useGraphSettingsStore.getInitialState())
})

describe('graph-settings-store', () => {
  it('has sensible defaults', () => {
    const state = useGraphSettingsStore.getState()
    expect(state.showOrphans).toBe(true)
    expect(state.nodeSizeMultiplier).toBe(1)
    expect(state.centerForce).toBe(0.03)
    expect(state.repelForce).toBe(-200)
    expect(state.isAnimating).toBe(true)
    expect(state.linkThickness).toBe(1)
    expect(state.linkDistance).toBe(80)
    expect(state.minEdgeWeight).toBe(0.3)
    expect(state.showMinimap).toBe(true)
    expect(state.groupRules).toHaveLength(4)
  })

  it('updates filter settings immutably', () => {
    useGraphSettingsStore.getState().setShowOrphans(false)
    expect(useGraphSettingsStore.getState().showOrphans).toBe(false)
  })

  it('updates force settings', () => {
    const { setCenterForce, setRepelForce } = useGraphSettingsStore.getState()
    setCenterForce(0.1)
    setRepelForce(-200)
    const state = useGraphSettingsStore.getState()
    expect(state.centerForce).toBe(0.1)
    expect(state.repelForce).toBe(-200)
  })

  it('updates display settings', () => {
    const { setNodeSizeMultiplier, setLinkThickness, setShowArrows } =
      useGraphSettingsStore.getState()
    setNodeSizeMultiplier(2)
    setLinkThickness(1.5)
    setShowArrows(true)
    const state = useGraphSettingsStore.getState()
    expect(state.nodeSizeMultiplier).toBe(2)
    expect(state.linkThickness).toBe(1.5)
    expect(state.showArrows).toBe(true)
  })

  it('adds a group rule', () => {
    const before = useGraphSettingsStore.getState().groupRules.length
    useGraphSettingsStore.getState().addGroupRule()
    const after = useGraphSettingsStore.getState().groupRules
    expect(after).toHaveLength(before + 1)
    expect(after[after.length - 1].query).toBe('')
  })

  it('removes a group rule', () => {
    const rules = useGraphSettingsStore.getState().groupRules
    const first = rules[0]
    useGraphSettingsStore.getState().removeGroupRule(first.id)
    expect(useGraphSettingsStore.getState().groupRules).toHaveLength(rules.length - 1)
    expect(
      useGraphSettingsStore.getState().groupRules.find((r) => r.id === first.id)
    ).toBeUndefined()
  })

  it('updates a group rule query', () => {
    const id = useGraphSettingsStore.getState().groupRules[0].id
    useGraphSettingsStore.getState().updateGroupRule(id, { query: 'path:"New"' })
    expect(useGraphSettingsStore.getState().groupRules[0].query).toBe('path:"New"')
  })

  it('cycles group rule color', () => {
    const id = useGraphSettingsStore.getState().groupRules[0].id
    const before = useGraphSettingsStore.getState().groupRules[0].color
    useGraphSettingsStore.getState().cycleGroupColor(id)
    const after = useGraphSettingsStore.getState().groupRules[0].color
    expect(after).not.toBe(before)
  })

  it('does not mutate previous state on group update', () => {
    const before = useGraphSettingsStore.getState().groupRules
    useGraphSettingsStore.getState().addGroupRule()
    const after = useGraphSettingsStore.getState().groupRules
    expect(before).not.toBe(after)
  })
})

describe('matchGroupRule', () => {
  it('matches tag rules', () => {
    expect(
      matchGroupRule(
        { id: '1', query: 'tag:#daily', color: '#fff' },
        { type: 'note', tags: ['daily', 'journal'] }
      )
    ).toBe(true)
  })

  it('matches tag rules without # prefix', () => {
    expect(
      matchGroupRule(
        { id: '1', query: 'tag:daily', color: '#fff' },
        { type: 'note', tags: ['daily'] }
      )
    ).toBe(true)
  })

  it('rejects non-matching tag rules', () => {
    expect(
      matchGroupRule(
        { id: '1', query: 'tag:#daily', color: '#fff' },
        { type: 'note', tags: ['weekly'] }
      )
    ).toBe(false)
  })

  it('matches path rules', () => {
    expect(
      matchGroupRule(
        { id: '1', query: 'path:"Projects"', color: '#fff' },
        { type: 'note', path: '/vault/Projects/ironlog.md' }
      )
    ).toBe(true)
  })

  it('rejects non-matching path rules', () => {
    expect(
      matchGroupRule(
        { id: '1', query: 'path:"Projects"', color: '#fff' },
        { type: 'note', path: '/vault/Books/naval.md' }
      )
    ).toBe(false)
  })

  it('matches type fallback', () => {
    expect(matchGroupRule({ id: '1', query: 'gene', color: '#fff' }, { type: 'gene' })).toBe(true)
  })
})

describe('resolveGroupColor', () => {
  it('returns first matching rule color', () => {
    const rules = [
      { id: '1', query: 'tag:#daily', color: '#ff0000' },
      { id: '2', query: 'path:"Projects"', color: '#00ff00' }
    ]
    const node = { type: 'note', tags: ['daily'], path: '/vault/Projects/x.md' }
    expect(resolveGroupColor(rules, node)).toBe('#ff0000')
  })

  it('returns null when no rule matches', () => {
    const rules = [{ id: '1', query: 'tag:#daily', color: '#ff0000' }]
    const node = { type: 'note', tags: ['weekly'] }
    expect(resolveGroupColor(rules, node)).toBeNull()
  })
})
