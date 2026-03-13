import type { Artifact, RelationshipKind } from '@shared/types'
import type { VaultIndex } from './indexer'

export interface RelatedArtifact {
  artifact: Artifact
  kind: RelationshipKind
}

export function getRelated(index: VaultIndex, id: string): RelatedArtifact[] {
  const artifact = index.getArtifact(id)
  if (!artifact) return []

  const related: RelatedArtifact[] = []
  const addRelated = (ids: readonly string[], kind: RelationshipKind): void => {
    for (const relId of ids) {
      const rel = index.getArtifact(relId)
      if (rel) related.push({ artifact: rel, kind })
    }
  }

  addRelated(artifact.connections, 'connection')
  addRelated(artifact.clusters_with, 'cluster')
  addRelated(artifact.tensions_with, 'tension')
  addRelated(artifact.appears_in, 'appears_in')

  return related
}

export function getNeighborhood(index: VaultIndex, id: string, depth: number = 1): Set<string> {
  const visited = new Set<string>()
  const queue: Array<{ id: string; d: number }> = [{ id, d: 0 }]

  while (queue.length > 0) {
    const { id: current, d } = queue.shift()!
    if (visited.has(current) || d > depth) continue
    visited.add(current)
    if (d < depth) {
      const related = getRelated(index, current)
      for (const r of related) {
        queue.push({ id: r.artifact.id, d: d + 1 })
      }
    }
  }

  return visited
}

export function filterByWorkspace(
  artifacts: readonly Artifact[],
  workspace: string | null
): Artifact[] {
  if (!workspace) return [...artifacts]
  return [...artifacts]
}
