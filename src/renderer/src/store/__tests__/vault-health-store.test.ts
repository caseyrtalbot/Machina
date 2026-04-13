import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CheckRun, DerivedHealth, InfraHealth, HealthIssue } from '@shared/engine/vault-health'

// --------------------------------------------------------------------------
// Cycle 1: Store skeleton + aggregation (Tasks 25-29)
// --------------------------------------------------------------------------

describe('vault-health-store', () => {
  // Dynamic import so the module isn't loaded before vi.mock calls in later cycles
  let useVaultHealthStore: typeof import('../vault-health-store').useVaultHealthStore

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../vault-health-store')
    useVaultHealthStore = mod.useVaultHealthStore
    useVaultHealthStore.setState(useVaultHealthStore.getInitialState())
  })

  it('initial state is unknown with null timestamps', () => {
    const state = useVaultHealthStore.getState()
    expect(state.status).toBe('unknown')
    expect(state.lastDerivedAt).toBeNull()
    expect(state.lastInfraAt).toBeNull()
    expect(state.issues).toEqual([])
    expect(state.runs).toEqual([])
  })

  it('setDerived updates derived fields and computes aggregate', () => {
    const now = Date.now()
    const derived: DerivedHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'parse-errors',
          ranAt: now,
          passed: true,
          issues: []
        },
        {
          checkId: 'broken-refs',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    // Also set infra so we leave the unknown→green path open
    const infra: InfraHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'vault-reachable',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    useVaultHealthStore.getState().setInfra(infra)
    useVaultHealthStore.getState().setDerived(derived)

    const state = useVaultHealthStore.getState()
    expect(state.status).toBe('green')
    expect(state.lastDerivedAt).toBe(now)
    expect(state.runs).toHaveLength(3)
  })

  it('setInfra updates infra fields and computes aggregate', () => {
    const now = Date.now()
    const infra: InfraHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'vault-reachable',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    useVaultHealthStore.getState().setInfra(infra)

    const state = useVaultHealthStore.getState()
    // Still unknown because lastDerivedAt is null
    expect(state.status).toBe('unknown')
    expect(state.lastInfraAt).toBe(now)
    expect(state.runs).toHaveLength(1)
  })

  it('degraded when any run fails', () => {
    const now = Date.now()
    const failIssue: HealthIssue = {
      checkId: 'parse-errors',
      severity: 'hard',
      title: 'Parse error',
      detail: 'bad frontmatter',
      filePath: 'notes/bad.md'
    }

    const derived: DerivedHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'parse-errors',
          ranAt: now,
          passed: false,
          issues: [failIssue]
        },
        {
          checkId: 'broken-refs',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    const infra: InfraHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'vault-reachable',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    useVaultHealthStore.getState().setInfra(infra)
    useVaultHealthStore.getState().setDerived(derived)

    const state = useVaultHealthStore.getState()
    expect(state.status).toBe('degraded')
    expect(state.issues).toHaveLength(1)
    expect(state.issues[0]).toEqual(failIssue)
  })

  it('issues sorted: hard before integrity, then alpha by checkId', () => {
    const now = Date.now()

    const integrityIssue: HealthIssue = {
      checkId: 'broken-refs',
      severity: 'integrity',
      title: 'Broken reference',
      detail: 'ref missing'
    }

    const hardIssueB: HealthIssue = {
      checkId: 'stale-worker-index',
      severity: 'hard',
      title: 'Stale index',
      detail: 'stale'
    }

    const hardIssueA: HealthIssue = {
      checkId: 'parse-errors',
      severity: 'hard',
      title: 'Parse error',
      detail: 'bad'
    }

    const derived: DerivedHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'broken-refs',
          ranAt: now,
          passed: false,
          issues: [integrityIssue]
        },
        {
          checkId: 'stale-worker-index',
          ranAt: now,
          passed: false,
          issues: [hardIssueB]
        },
        {
          checkId: 'parse-errors',
          ranAt: now,
          passed: false,
          issues: [hardIssueA]
        }
      ]
    }

    const infra: InfraHealth = {
      computedAt: now,
      runs: [
        {
          checkId: 'vault-reachable',
          ranAt: now,
          passed: true,
          issues: []
        }
      ]
    }

    useVaultHealthStore.getState().setInfra(infra)
    useVaultHealthStore.getState().setDerived(derived)

    const state = useVaultHealthStore.getState()
    // hard issues first (parse-errors, stale-worker-index), then integrity (broken-refs)
    expect(state.issues[0].checkId).toBe('parse-errors')
    expect(state.issues[1].checkId).toBe('stale-worker-index')
    expect(state.issues[2].checkId).toBe('broken-refs')
  })
})
