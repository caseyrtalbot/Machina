import { describe, it, expect } from 'vitest'
import { AGENT_ACTIONS, AGENT_ACTION_NAMES } from '@shared/agent-action-types'
import type { AgentActionName } from '@shared/agent-action-types'

describe('AGENT_ACTIONS registry', () => {
  it('has six actions', () => {
    expect(AGENT_ACTIONS).toHaveLength(6)
  })

  it('contains challenge, emerge, organize, tidy, compile, ask', () => {
    const ids = AGENT_ACTIONS.map((a) => a.id)
    expect(ids).toEqual(['challenge', 'emerge', 'organize', 'tidy', 'compile', 'ask'])
  })

  it('exports AGENT_ACTION_NAMES matching registry ids', () => {
    expect(AGENT_ACTION_NAMES).toEqual([
      'challenge',
      'emerge',
      'organize',
      'tidy',
      'compile',
      'ask'
    ])
  })

  it('challenge requires no selection (vault-scope capable)', () => {
    const challenge = AGENT_ACTIONS.find((a) => a.id === 'challenge')!
    expect(challenge.requiresSelection).toBe(0)
  })

  it('compile requires 1+ selection', () => {
    const compile = AGENT_ACTIONS.find((a) => a.id === 'compile')!
    expect(compile.requiresSelection).toBe(1)
  })

  it('organize requires 2+ selection', () => {
    const organize = AGENT_ACTIONS.find((a) => a.id === 'organize')!
    expect(organize.requiresSelection).toBe(2)
  })

  it('tidy requires no selection', () => {
    const tidy = AGENT_ACTIONS.find((a) => a.id === 'tidy')!
    expect(tidy.requiresSelection).toBe(0)
  })

  it('ask requires no selection (vault-scope capable)', () => {
    const ask = AGENT_ACTIONS.find((a) => a.id === 'ask')!
    expect(ask.requiresSelection).toBe(0)
  })

  it('all actions have label, description, and keywords', () => {
    for (const action of AGENT_ACTIONS) {
      expect(action.label).toBeTruthy()
      expect(action.description).toBeTruthy()
      expect(action.keywords.length).toBeGreaterThan(0)
    }
  })

  it('AgentActionName type is a union of the six ids', () => {
    const name: AgentActionName = 'challenge'
    expect(AGENT_ACTION_NAMES).toContain(name)
  })
})
