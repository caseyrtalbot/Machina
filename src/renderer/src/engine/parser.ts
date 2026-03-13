import matter from 'gray-matter'
import type { Artifact, ArtifactType, Signal } from '@shared/types'
import type { Result } from './types'

const VALID_TYPES = new Set<string>(['gene', 'constraint', 'research', 'output', 'note', 'index'])
const VALID_SIGNALS = new Set<string>(['untested', 'emerging', 'validated', 'core'])

function toStringArray(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String)
  return []
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'string') return val
  return new Date().toISOString().split('T')[0]
}

export function parseArtifact(content: string, filename: string): Result<Artifact> {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch {
    return { ok: false, error: `Failed to parse frontmatter in ${filename}` }
  }

  const { data, content: body } = parsed

  if (!data || typeof data !== 'object' || !data.id || !data.title || !data.type) {
    return {
      ok: false,
      error: `Missing required frontmatter fields (id, title, type) in ${filename}`
    }
  }

  if (!VALID_TYPES.has(data.type)) {
    return { ok: false, error: `Invalid artifact type "${data.type}" in ${filename}` }
  }

  const signal = VALID_SIGNALS.has(data.signal) ? (data.signal as Signal) : 'untested'

  return {
    ok: true,
    value: {
      id: String(data.id),
      title: String(data.title),
      type: data.type as ArtifactType,
      created: toDateString(data.created),
      modified: toDateString(data.modified),
      source: data.source ? String(data.source) : undefined,
      frame: data.frame ? String(data.frame) : undefined,
      signal,
      tags: toStringArray(data.tags),
      connections: toStringArray(data.connections),
      clusters_with: toStringArray(data.clusters_with),
      tensions_with: toStringArray(data.tensions_with),
      appears_in: toStringArray(data.appears_in),
      body: body.trim()
    }
  }
}

export function serializeArtifact(artifact: Artifact): string {
  const frontmatter: Record<string, unknown> = {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    created: artifact.created,
    modified: artifact.modified
  }

  if (artifact.source) frontmatter.source = artifact.source
  if (artifact.frame) frontmatter.frame = artifact.frame
  if (artifact.signal !== 'untested') frontmatter.signal = artifact.signal
  if (artifact.tags.length > 0) frontmatter.tags = artifact.tags
  if (artifact.connections.length > 0) frontmatter.connections = artifact.connections
  if (artifact.clusters_with.length > 0) frontmatter.clusters_with = artifact.clusters_with
  if (artifact.tensions_with.length > 0) frontmatter.tensions_with = artifact.tensions_with
  if (artifact.appears_in.length > 0) frontmatter.appears_in = artifact.appears_in

  return matter.stringify(artifact.body, frontmatter)
}
