import type { Artifact } from '@shared/types'

export interface TagTreeNode {
  readonly name: string
  readonly fullPath: string
  readonly count: number
  readonly children: readonly TagTreeNode[]
}

interface MutableTagNode {
  name: string
  fullPath: string
  directCount: number
  children: Map<string, MutableTagNode>
}

function normalizeTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.replace(/^#/, '').trim()).filter((t) => t.length > 0)
}

function getOrCreateChild(
  parent: MutableTagNode,
  segment: string,
  fullPath: string
): MutableTagNode {
  let child = parent.children.get(segment)
  if (!child) {
    child = { name: segment, fullPath, directCount: 0, children: new Map() }
    parent.children.set(segment, child)
  }
  return child
}

function freezeNode(node: MutableTagNode): TagTreeNode {
  const children = Array.from(node.children.values())
    .map(freezeNode)
    .sort((a, b) => a.name.localeCompare(b.name))

  const aggregateCount = node.directCount + children.reduce((sum, c) => sum + c.count, 0)

  return {
    name: node.name,
    fullPath: node.fullPath,
    count: aggregateCount,
    children
  }
}

export function buildTagIndex(artifacts: readonly Artifact[]): readonly TagTreeNode[] {
  const root: MutableTagNode = { name: '', fullPath: '', directCount: 0, children: new Map() }

  for (const artifact of artifacts) {
    const tags = normalizeTags(artifact.tags)
    for (const tag of tags) {
      const segments = tag.split('/').filter((s) => s.length > 0)
      if (segments.length === 0) continue

      let current = root
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const fullPath = segments.slice(0, i + 1).join('/')
        current = getOrCreateChild(current, segment, fullPath)
      }
      current.directCount++
    }
  }

  return Array.from(root.children.values())
    .map(freezeNode)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterArtifactsByTags(
  artifacts: readonly Artifact[],
  selectedTags: readonly string[],
  operator: 'and' | 'or'
): readonly Artifact[] {
  if (selectedTags.length === 0) return artifacts

  return artifacts.filter((artifact) => {
    const normalizedTags = normalizeTags(artifact.tags)
    if (operator === 'or') {
      return selectedTags.some((tag) =>
        normalizedTags.some((t) => t === tag || t.startsWith(`${tag}/`))
      )
    }
    return selectedTags.every((tag) =>
      normalizedTags.some((t) => t === tag || t.startsWith(`${tag}/`))
    )
  })
}
