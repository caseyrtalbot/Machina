// ---------------------------------------------------------------------------
// Branded types: prevent mixing up IDs and paths at compile time.
// Use the constructor functions to create values of these types.
// ---------------------------------------------------------------------------

export type ArtifactId = string & { readonly __brand: 'ArtifactId' }
export type FilePath = string & { readonly __brand: 'FilePath' }
export type SessionId = string & { readonly __brand: 'SessionId' }

export function artifactId(id: string): ArtifactId {
  return id as ArtifactId
}

export function filePath(path: string): FilePath {
  return path as FilePath
}

export function sessionId(id: string): SessionId {
  return id as SessionId
}

// ---------------------------------------------------------------------------

export const ARTIFACT_TYPES = [
  'gene',
  'constraint',
  'research',
  'output',
  'note',
  'index',
  'session',
  'pattern',
  'tension'
] as const
export type BuiltInArtifactType = (typeof ARTIFACT_TYPES)[number]
export type ArtifactType = string

export function isBuiltInType(t: string): t is BuiltInArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(t)
}

export const SIGNALS = ['untested', 'emerging', 'validated', 'core'] as const
export type Signal = (typeof SIGNALS)[number]

export const TYPE_PREFIXES = {
  gene: 'g',
  constraint: 'c',
  research: 'r',
  output: 'o',
  note: 'n',
  index: 'i',
  session: 's',
  pattern: 'p',
  tension: 't'
} as const satisfies Record<BuiltInArtifactType, string>

export const SIGNAL_OPACITY = {
  core: 1.0,
  validated: 0.9,
  emerging: 0.8,
  untested: 0.65
} as const satisfies Record<Signal, number>

export interface Artifact {
  id: string
  title: string
  type: ArtifactType
  created: string
  modified: string
  source?: string
  frame?: string
  signal: Signal
  tags: string[]
  connections: string[]
  clusters_with: string[]
  tensions_with: string[]
  appears_in: string[]
  related: string[]
  concepts: readonly string[]
  /** Wikilink targets extracted from body text (derived, not persisted to disk). */
  readonly bodyLinks: readonly string[]
  body: string
  /** Raw frontmatter key-value pairs for metadata display (e.g. AUTHOR, CATEGORY). */
  readonly frontmatter: Readonly<Record<string, unknown>>
}

export const RELATIONSHIP_KINDS = [
  'connection',
  'cluster',
  'tension',
  'appears_in',
  'related',
  'co-occurrence'
] as const
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number]

export interface Relationship {
  source: string
  target: string
  kind: RelationshipKind
}

export interface GraphNode {
  id: string
  title: string
  type: ArtifactType
  signal: Signal
  connectionCount: number
  tags?: string[]
  path?: string
  created?: string
  x?: number
  y?: number
}

export interface GraphEdge {
  source: string
  target: string
  kind: RelationshipKind
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface VaultConfig {
  version: number
  fonts: { display: string; body: string; mono: string }
  workspaces: string[]
  createdAt: string
}

export interface VaultState {
  version: number
  idCounters: Record<string, number>
  lastOpenNote: string | null
  panelLayout: { sidebarWidth: number; terminalWidth: number }
  contentView: 'editor' | 'canvas' | 'skills'
  terminalSessions: string[]
  fileTreeCollapseState: Record<string, boolean>
  selectedNodeId: string | null
  recentFiles: string[]
}
