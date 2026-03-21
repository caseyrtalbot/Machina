import type { Artifact, KnowledgeGraph } from '@shared/types'

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }

export interface ParseError {
  readonly filename: string
  readonly error: string
}

export interface WorkerResult {
  readonly artifacts: readonly Artifact[]
  readonly graph: KnowledgeGraph
  readonly errors: readonly ParseError[]
  readonly fileToId: Readonly<Record<string, string>>
  readonly artifactPathById: Readonly<Record<string, string>>
}
