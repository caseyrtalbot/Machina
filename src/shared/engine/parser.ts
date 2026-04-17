import matter from 'gray-matter'
import type { Artifact, Signal } from '@shared/types'
import type { AgentArtifactDraft } from '@shared/agent-artifact-types'

// Disable gray-matter's JavaScript engine (uses eval) to prevent code injection
const SAFE_MATTER_OPTIONS = {
  engines: {
    javascript: { parse: (): Record<string, unknown> => ({}), stringify: (): string => '' }
  }
}
import type { Result } from './types'
import { extractConceptNodes } from './concept-extractor'

const VALID_SIGNALS = new Set<string>(['untested', 'emerging', 'validated', 'core'])
const VALID_ORIGINS = new Set<string>(['human', 'source', 'agent'])

function toStringArray(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String)
  return []
}

/** Strip [[brackets]] from wikilink values: "[[Foo]]" → "Foo", "[[Foo|Bar]]" → "Foo" */
function stripWikilinks(values: string[]): string[] {
  return values.map((v) => v.replace(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/, '$1').trim())
}

/** Extract [[wikilink]] targets from markdown body text. Deduplicated, case-normalized. */
function extractBodyWikilinks(body: string): readonly string[] {
  const matches = body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)
  const targets = new Set<string>()
  for (const m of matches) {
    targets.add(m[1].trim().toLowerCase())
  }
  return [...targets]
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'string') return val
  return new Date().toISOString().split('T')[0]
}

/**
 * Extract the filename stem from a path.
 * `/path/to/Claude Code Playbook.md` → `Claude Code Playbook`
 */
function filenameStem(filepath: string): string {
  const basename = filepath.split('/').pop() ?? filepath
  return basename.replace(/\.md$/i, '')
}

/**
 * Extract the first H1 heading from markdown body.
 * Returns null if no H1 is found.
 */
function extractTitleFromBody(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

export function parseArtifact(content: string, filename: string): Result<Artifact> {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content, SAFE_MATTER_OPTIONS)
  } catch {
    return { ok: false, error: `Failed to parse frontmatter in ${filename}` }
  }

  const { data, content: body } = parsed
  const stem = filenameStem(filename)

  // Derive id: explicit frontmatter → filename stem
  const id = data?.id ? String(data.id) : stem

  // Derive title: explicit frontmatter → first H1 → filename stem
  const title = data?.title ? String(data.title) : (extractTitleFromBody(body) ?? stem)

  const signal = VALID_SIGNALS.has(data?.signal) ? (data.signal as Signal) : 'untested'

  return {
    ok: true,
    value: {
      id,
      title,
      type: typeof data?.type === 'string' && data.type ? data.type : 'note',
      created: toDateString(data?.created),
      modified: toDateString(data?.modified),
      source: data?.source ? String(data.source) : undefined,
      frame: data?.frame ? String(data.frame) : undefined,
      signal,
      tags: toStringArray(data?.tags),
      connections: stripWikilinks(toStringArray(data?.connections)),
      clusters_with: stripWikilinks(toStringArray(data?.clusters_with)),
      tensions_with: stripWikilinks(toStringArray(data?.tensions_with)),
      appears_in: stripWikilinks(toStringArray(data?.appears_in)),
      related: stripWikilinks(toStringArray(data?.related)),
      origin: VALID_ORIGINS.has(data?.origin)
        ? (data.origin as 'human' | 'source' | 'agent')
        : 'human',
      sources: stripWikilinks(toStringArray(data?.sources)),
      concepts: extractConceptNodes(body),
      bodyLinks: extractBodyWikilinks(body),
      body: body.trim(),
      frontmatter: data ?? {}
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

  if (artifact.origin !== 'human') frontmatter.origin = artifact.origin
  if (artifact.sources.length > 0) frontmatter.sources = [...artifact.sources]
  if (artifact.source) frontmatter.source = artifact.source
  if (artifact.frame) frontmatter.frame = artifact.frame
  if (artifact.signal !== 'untested') frontmatter.signal = artifact.signal
  if (artifact.tags.length > 0) frontmatter.tags = artifact.tags
  if (artifact.connections.length > 0) frontmatter.connections = artifact.connections
  if (artifact.clusters_with.length > 0) frontmatter.clusters_with = artifact.clusters_with
  if (artifact.tensions_with.length > 0) frontmatter.tensions_with = artifact.tensions_with
  if (artifact.appears_in.length > 0) frontmatter.appears_in = artifact.appears_in
  if (artifact.related.length > 0) frontmatter.related = artifact.related

  // Preserve custom frontmatter keys not handled explicitly above
  const EXPLICIT_KEYS = new Set([
    'id',
    'title',
    'type',
    'created',
    'modified',
    'source',
    'frame',
    'signal',
    'tags',
    'connections',
    'clusters_with',
    'tensions_with',
    'appears_in',
    'related',
    'concepts',
    'origin',
    'sources'
  ])

  for (const [key, value] of Object.entries(artifact.frontmatter)) {
    if (!EXPLICIT_KEYS.has(key)) {
      frontmatter[key] = value
    }
  }

  return matter.stringify(artifact.body, frontmatter)
}

export function serializeDraft(draft: AgentArtifactDraft, id: string): string {
  const now = new Date().toISOString()
  const frontmatter: Record<string, unknown> = {
    id,
    title: draft.title,
    type: draft.kind === 'compiled-article' ? 'output' : draft.kind,
    created: now,
    modified: now
  }

  if (draft.origin !== 'human') frontmatter.origin = draft.origin
  if (draft.sources.length > 0) frontmatter.sources = [...draft.sources]
  if (draft.tags && draft.tags.length > 0) frontmatter.tags = [...draft.tags]

  if (draft.kind !== 'compiled-article') {
    // Cluster serialization is implemented in a later task; for now only
    // compiled-article drafts are materialized through this path.
    throw new Error(`serializeDraft: unsupported draft kind '${draft.kind}'`)
  }

  if (draft.frontmatterExtras) {
    for (const [key, value] of Object.entries(draft.frontmatterExtras)) {
      frontmatter[key] = value
    }
  }

  return matter.stringify(draft.body, frontmatter)
}
