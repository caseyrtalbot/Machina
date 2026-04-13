import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DerivedHealth, InfraHealth, HealthIssue } from '@shared/engine/vault-health'
import type { WorkerResult } from '@shared/engine/types'

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

// --------------------------------------------------------------------------
// Cycle 2: Vault-store workerResult subscription wiring (Tasks 30-34)
// --------------------------------------------------------------------------

describe('vault-health-store subscription wiring', () => {
  let useVaultHealthStore: typeof import('../vault-health-store').useVaultHealthStore
  let useVaultStore: typeof import('../vault-store').useVaultStore

  beforeEach(async () => {
    vi.resetModules()
    // Import vault-store first so the subscription target exists
    const vaultMod = await import('../vault-store')
    useVaultStore = vaultMod.useVaultStore
    // Import health store which sets up the subscription
    const healthMod = await import('../vault-health-store')
    useVaultHealthStore = healthMod.useVaultHealthStore
    useVaultHealthStore.setState(useVaultHealthStore.getInitialState())
  })

  it('subscribes to vault-store workerResult and runs computeDerivedHealth', () => {
    const workerResult: WorkerResult = {
      artifacts: [],
      graph: { nodes: [], edges: [] },
      errors: [{ filename: 'bad.md', error: 'parse fail' }],
      fileToId: {},
      artifactPathById: {}
    }

    // Set files first so stale-worker-index doesn't fire for unrelated reasons
    useVaultStore.setState({ files: [] })

    // Trigger setWorkerResult which stores derived fields
    useVaultStore.getState().setWorkerResult(workerResult)

    // Give the subscription time to fire (it's synchronous via zustand subscribe)
    const state = useVaultHealthStore.getState()
    expect(state.lastDerivedAt).not.toBeNull()
    // parse-errors check should produce a degraded status (once infra is also set)
    // But without infra, it stays unknown
    expect(state.runs.length).toBeGreaterThan(0)
    // Verify we have a parse-errors run that failed
    const parseRun = state.runs.find((r) => r.checkId === 'parse-errors')
    expect(parseRun).toBeDefined()
    expect(parseRun!.passed).toBe(false)
  })

  it('recomputes on each new workerResult', () => {
    // First result: has errors
    const result1: WorkerResult = {
      artifacts: [],
      graph: { nodes: [], edges: [] },
      errors: [{ filename: 'bad.md', error: 'parse fail' }],
      fileToId: {},
      artifactPathById: {}
    }

    useVaultStore.setState({ files: [] })
    useVaultStore.getState().setWorkerResult(result1)

    const state1 = useVaultHealthStore.getState()
    const firstDerivedAt = state1.lastDerivedAt
    expect(firstDerivedAt).not.toBeNull()

    // Second result: no errors
    const result2: WorkerResult = {
      artifacts: [],
      graph: { nodes: [], edges: [] },
      errors: [],
      fileToId: {},
      artifactPathById: {}
    }

    useVaultStore.getState().setWorkerResult(result2)

    const state2 = useVaultHealthStore.getState()
    expect(state2.lastDerivedAt).not.toBeNull()
    // All runs should pass now
    const parseRun = state2.runs.find((r) => r.checkId === 'parse-errors')
    expect(parseRun).toBeDefined()
    expect(parseRun!.passed).toBe(true)
  })
})
