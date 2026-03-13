import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'
import type { Artifact, KnowledgeGraph } from '@shared/types'

interface ParseError {
  filename: string
  error: string
}

interface WorkerResult {
  artifacts: Artifact[]
  graph: KnowledgeGraph
  errors: ParseError[]
  fileToId: Record<string, string>
}

export function createWorkerHelpers() {
  const artifacts = new Map<string, Artifact>()
  const fileToId = new Map<string, string>()
  const errors: ParseError[] = []

  function clearErrorsForPath(path: string): void {
    for (let i = errors.length - 1; i >= 0; i--) {
      if (errors[i].filename === path) errors.splice(i, 1)
    }
  }

  function addFile(path: string, content: string): void {
    clearErrorsForPath(path)
    const result = parseArtifact(content, path)
    if (result.ok) {
      artifacts.set(result.value.id, result.value)
      fileToId.set(path, result.value.id)
    } else {
      errors.push({ filename: path, error: result.error })
    }
  }

  function removeFile(path: string): void {
    clearErrorsForPath(path)
    const id = fileToId.get(path)
    if (id) {
      artifacts.delete(id)
      fileToId.delete(path)
    }
  }

  function buildResult(): WorkerResult {
    const arts = Array.from(artifacts.values())
    const graph = buildGraph(arts)
    const fToId: Record<string, string> = {}
    for (const [k, v] of fileToId) fToId[k] = v
    return { artifacts: arts, graph, errors: [...errors], fileToId: fToId }
  }

  function clearAll(): void {
    artifacts.clear()
    fileToId.clear()
    errors.length = 0
  }

  return { addFile, removeFile, buildResult, clearAll }
}
