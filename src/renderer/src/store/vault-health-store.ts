import { create } from 'zustand'
import type {
  AggregateHealth,
  CheckRun,
  DerivedHealth,
  HealthIssue,
  HealthStatus,
  InfraHealth
} from '@shared/engine/vault-health'
import { computeDerivedHealth } from '@shared/engine/vault-health'
import { useVaultStore } from './vault-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEARTBEAT_MS = 30_000
export const STALENESS_MULTIPLIER = 2.5

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface VaultHealthState extends AggregateHealth {
  setDerived: (health: DerivedHealth) => void
  setInfra: (health: InfraHealth) => void
  reset: () => void
}

const INITIAL_STATE: AggregateHealth = {
  status: 'unknown',
  lastDerivedAt: null,
  lastInfraAt: null,
  issues: [],
  runs: []
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function sortIssues(issues: readonly HealthIssue[]): readonly HealthIssue[] {
  return [...issues].sort((a, b) => {
    // hard before integrity
    if (a.severity !== b.severity) {
      return a.severity === 'hard' ? -1 : 1
    }
    // then alpha by checkId
    return a.checkId.localeCompare(b.checkId)
  })
}

function mergeRuns(
  existing: readonly CheckRun[],
  incoming: readonly CheckRun[]
): readonly CheckRun[] {
  const incomingIds = new Set(incoming.map((r) => r.checkId))
  const kept = existing.filter((r) => !incomingIds.has(r.checkId))
  return [...kept, ...incoming]
}

function computeStatus(
  runs: readonly CheckRun[],
  lastDerivedAt: number | null,
  lastInfraAt: number | null
): HealthStatus {
  if (lastDerivedAt === null || lastInfraAt === null) {
    return 'unknown'
  }

  const stalenessThreshold = HEARTBEAT_MS * STALENESS_MULTIPLIER
  if (Date.now() - lastInfraAt > stalenessThreshold) {
    return 'unknown'
  }

  const anyFailed = runs.some((r) => !r.passed)
  return anyFailed ? 'degraded' : 'green'
}

function flattenIssues(runs: readonly CheckRun[]): readonly HealthIssue[] {
  return sortIssues(runs.flatMap((r) => r.issues))
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useVaultHealthStore = create<VaultHealthState>()((set, get) => {
  function applyIncoming(
    incoming: DerivedHealth | InfraHealth,
    timestampKey: 'lastDerivedAt' | 'lastInfraAt'
  ): void {
    const prev = get()
    const runs = mergeRuns(prev.runs, incoming.runs)
    const lastDerivedAt =
      timestampKey === 'lastDerivedAt' ? incoming.computedAt : prev.lastDerivedAt
    const lastInfraAt = timestampKey === 'lastInfraAt' ? incoming.computedAt : prev.lastInfraAt
    const status = computeStatus(runs, lastDerivedAt, lastInfraAt)
    const issues = flattenIssues(runs)
    set({ runs, status, issues, [timestampKey]: incoming.computedAt })
  }

  return {
    ...INITIAL_STATE,
    setDerived: (health) => applyIncoming(health, 'lastDerivedAt'),
    setInfra: (health) => applyIncoming(health, 'lastInfraAt'),
    reset: () => set({ ...INITIAL_STATE })
  }
})

// ---------------------------------------------------------------------------
// Vault-store subscription: recompute derived health when worker result changes
// ---------------------------------------------------------------------------

let _prevArtifactsRef: readonly unknown[] = useVaultStore.getState().artifacts

useVaultStore.subscribe((state) => {
  // Only react when artifacts reference changes (proxy for setWorkerResult)
  if (state.artifacts === _prevArtifactsRef) return
  _prevArtifactsRef = state.artifacts

  const derived = computeDerivedHealth({
    workerResult: {
      artifacts: state.artifacts,
      errors: state.parseErrors,
      fileToId: state.fileToId,
      artifactPathById: state.artifactPathById,
      graph: state.graph
    },
    files: state.files
  })

  useVaultHealthStore.getState().setDerived(derived)

  if (typeof window !== 'undefined' && window.api?.health) {
    window.api.health.heartbeat({ at: Date.now() })
  }
})

// ---------------------------------------------------------------------------
// Infra report listener: receive InfraHealth from main process
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && window.api?.on?.healthReport) {
  window.api.on.healthReport((health) => {
    useVaultHealthStore.getState().setInfra(health)
  })
}

// ---------------------------------------------------------------------------
// Vault-store subscription: reset on vault path change (close or A→B swap)
// ---------------------------------------------------------------------------

let _prevVaultPath: string | null = useVaultStore.getState().vaultPath

useVaultStore.subscribe((state) => {
  if (state.vaultPath === _prevVaultPath) return
  _prevVaultPath = state.vaultPath

  // Reset artifacts ref so the worker subscription doesn't skip the next update
  _prevArtifactsRef = state.artifacts

  useVaultHealthStore.getState().reset()
})
