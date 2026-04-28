import type { WorkerResult } from '@shared/engine/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthSeverity = 'hard' | 'integrity'
export type HealthStatus = 'green' | 'degraded' | 'unknown'

export type CheckId =
  | 'parse-errors'
  | 'broken-refs'
  | 'stale-worker-index'
  | 'vault-reachable'
  | 'watcher-alive'
  | 'worker-responsive'
  | 'recent-disk-errors'

export interface HealthIssue {
  readonly checkId: CheckId
  readonly severity: HealthSeverity
  readonly title: string
  readonly detail: string
  readonly filePath?: string
}

export interface CheckRun {
  readonly checkId: CheckId
  readonly ranAt: number
  readonly passed: boolean
  readonly issues: readonly HealthIssue[]
}

export interface DerivedHealth {
  readonly runs: readonly CheckRun[]
  readonly computedAt: number
}

export interface InfraHealth {
  readonly runs: readonly CheckRun[]
  readonly computedAt: number
}

export interface AggregateHealth {
  readonly status: HealthStatus
  readonly issues: readonly HealthIssue[]
  readonly runs: readonly CheckRun[]
  readonly lastDerivedAt: number | null
  readonly lastInfraAt: number | null
}

interface VaultFile {
  readonly path: string
  readonly filename: string
}

// ---------------------------------------------------------------------------
// runCheck helper
// ---------------------------------------------------------------------------

function runCheck(id: CheckId, fn: () => readonly HealthIssue[]): CheckRun {
  try {
    const issues = fn()
    return {
      checkId: id,
      ranAt: Date.now(),
      passed: issues.length === 0,
      issues
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      checkId: id,
      ranAt: Date.now(),
      passed: false,
      issues: [
        {
          checkId: id,
          severity: 'hard',
          title: 'Health check crashed',
          detail: message
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Check: parse-errors
// ---------------------------------------------------------------------------

function checkParseErrors(workerResult: WorkerResult): readonly HealthIssue[] {
  return workerResult.errors.map((e) => ({
    checkId: 'parse-errors' as const,
    severity: 'hard' as const,
    title: 'Parse error',
    detail: e.error,
    filePath: e.filename
  }))
}

// ---------------------------------------------------------------------------
// Check: broken-refs
// ---------------------------------------------------------------------------

function checkBrokenRefs(workerResult: WorkerResult): readonly HealthIssue[] {
  const validIds = new Set(workerResult.artifacts.map((a) => a.id))
  const parseErrorIds = new Set(
    workerResult.errors
      .map((e) => workerResult.fileToId[e.filename])
      .filter((id): id is string => id !== undefined)
  )

  const issues: HealthIssue[] = []

  for (const artifact of workerResult.artifacts) {
    if (parseErrorIds.has(artifact.id)) continue

    const allRefs = [
      ...artifact.connections,
      ...artifact.clusters_with,
      ...artifact.tensions_with,
      ...artifact.appears_in,
      ...artifact.related
    ]

    for (const ref of allRefs) {
      if (!validIds.has(ref)) {
        issues.push({
          checkId: 'broken-refs',
          severity: 'integrity',
          title: 'Broken reference',
          detail: `${artifact.id} references ${ref} which does not exist`,
          filePath: workerResult.artifactPathById[artifact.id]
        })
      }
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Check: stale-worker-index
// ---------------------------------------------------------------------------

function checkStaleWorkerIndex(
  workerResult: WorkerResult,
  files: readonly VaultFile[]
): readonly HealthIssue[] {
  const filePaths = new Set(files.map((f) => f.path))
  const indexedPaths = new Set(Object.keys(workerResult.fileToId))
  const parseErrorPaths = new Set(workerResult.errors.map((e) => e.filename))

  const issues: HealthIssue[] = []

  // Files on disk not in worker index (excluding parse-error files)
  for (const fp of filePaths) {
    if (parseErrorPaths.has(fp)) continue
    if (!indexedPaths.has(fp)) {
      issues.push({
        checkId: 'stale-worker-index',
        severity: 'hard',
        title: 'File not in worker index',
        detail: `${fp} exists on disk but is not in the worker index`,
        filePath: fp
      })
    }
  }

  // Worker entries with no source file
  for (const ip of indexedPaths) {
    if (!filePaths.has(ip)) {
      issues.push({
        checkId: 'stale-worker-index',
        severity: 'hard',
        title: 'Stale worker index entry',
        detail: `${ip} is in the worker index but has no source file`,
        filePath: ip
      })
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// computeDerivedHealth
// ---------------------------------------------------------------------------

export function computeDerivedHealth(input: {
  workerResult: WorkerResult
  files: readonly VaultFile[]
}): DerivedHealth {
  const { workerResult, files } = input

  const runs: CheckRun[] = [
    runCheck('parse-errors', () => checkParseErrors(workerResult)),
    runCheck('broken-refs', () => checkBrokenRefs(workerResult)),
    runCheck('stale-worker-index', () => checkStaleWorkerIndex(workerResult, files))
  ]

  return {
    runs,
    computedAt: Date.now()
  }
}
