import type { Artifact, KnowledgeGraph } from '@shared/types'
import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'

interface ParseError {
  filename: string
  error: string
}

export class VaultIndex {
  private artifacts = new Map<string, Artifact>()
  private fileToId = new Map<string, string>()
  private errors: ParseError[] = []
  private graphCache: KnowledgeGraph | null = null

  addFile(filename: string, content: string): void {
    this.graphCache = null
    const result = parseArtifact(content, filename)
    if (result.ok) {
      this.artifacts.set(result.value.id, result.value)
      this.fileToId.set(filename, result.value.id)
    } else {
      this.errors.push({ filename, error: result.error })
    }
  }

  updateFile(filename: string, content: string): void {
    this.removeFile(filename)
    this.addFile(filename, content)
  }

  removeFile(filename: string): void {
    this.graphCache = null
    const id = this.fileToId.get(filename)
    if (id) {
      this.artifacts.delete(id)
      this.fileToId.delete(filename)
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

  search(query: string): Artifact[] {
    const lower = query.toLowerCase()
    return this.getArtifacts().filter(
      (a) =>
        a.title.toLowerCase().includes(lower) ||
        a.tags.some((t) => t.toLowerCase().includes(lower)) ||
        a.body.toLowerCase().includes(lower)
    )
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

  getErrors(): ParseError[] {
    return [...this.errors]
  }

  getIdForFile(filename: string): string | undefined {
    return this.fileToId.get(filename)
  }
}
