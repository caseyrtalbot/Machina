import type { Artifact, KnowledgeGraph } from '@shared/types'
import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'
import type { ParseError } from './types'

/** Outcome of ingesting one file: the stored artifact, or the parse error. */
export interface IngestResult {
  readonly artifact: Artifact | null
  readonly error: ParseError | null
}

export class VaultIndex {
  private artifacts = new Map<string, Artifact>()
  private fileToId = new Map<string, string>()
  private artifactPathById = new Map<string, string>()
  private graphCache: KnowledgeGraph | null = null

  addFile(filename: string, content: string): IngestResult {
    this.graphCache = null
    const result = parseArtifact(content, filename)
    if (!result.ok) {
      return { artifact: null, error: { filename, error: result.error } }
    }
    let id = result.value.id
    if (this.artifacts.has(id)) {
      let suffix = 2
      while (this.artifacts.has(`${id}-${suffix}`)) suffix++
      id = `${id}-${suffix}`
    }
    const artifact = id !== result.value.id ? { ...result.value, id } : result.value
    this.artifacts.set(id, artifact)
    this.fileToId.set(filename, id)
    this.artifactPathById.set(id, filename)
    return { artifact, error: null }
  }

  updateFile(filename: string, content: string): IngestResult {
    this.removeFile(filename)
    return this.addFile(filename, content)
  }

  removeFile(filename: string): void {
    this.graphCache = null
    const id = this.fileToId.get(filename)
    if (id) {
      this.artifacts.delete(id)
      this.fileToId.delete(filename)
      this.artifactPathById.delete(id)
    }
  }

  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id)
  }

  getArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values())
  }

  getGraph(): KnowledgeGraph {
    if (!this.graphCache) {
      this.graphCache = buildGraph(this.getArtifacts())
    }
    return this.graphCache
  }

  getBacklinks(targetId: string): Artifact[] {
    const graph = this.getGraph()
    const sourceIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.target === targetId && edge.source !== targetId) {
        sourceIds.add(edge.source)
      }
      if (edge.source === targetId && edge.target !== targetId && edge.kind !== 'appears_in') {
        sourceIds.add(edge.target)
      }
    }
    return this.getArtifacts().filter((a) => sourceIds.has(a.id))
  }

  getIdForFile(filename: string): string | undefined {
    return this.fileToId.get(filename)
  }

  getPathForArtifact(id: string): string | undefined {
    return this.artifactPathById.get(id)
  }
}
