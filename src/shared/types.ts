// ---------------------------------------------------------------------------
// Branded types: prevent mixing up IDs and paths at compile time.
// Use the constructor functions to create values of these types.
// ---------------------------------------------------------------------------

export type SessionId = string & { readonly __brand: 'SessionId' }

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
  /** Provenance: who created this artifact. */
  readonly origin: 'human' | 'source' | 'agent'
  /** Wikilink titles of source artifacts this was derived from. */
  readonly sources: readonly string[]
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
  'co-occurrence',
  'derived_from'
] as const
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number]

export interface GraphNode {
  id: string
  title: string
  type: ArtifactType
  signal: Signal
  connectionCount: number
  origin?: 'human' | 'source' | 'agent'
  tags?: string[]
  path?: string
  created?: string
  x?: number
  y?: number
}

export interface EdgeProvenance {
  source: 'frontmatter' | 'wikilink' | 'co-occurrence' | 'agent' | 'manual'
  createdBy?: string
  confidence?: number
  createdAt?: string
}

export interface GraphEdge {
  source: string
  target: string
  kind: RelationshipKind
  provenance?: EdgeProvenance
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface FilesystemFileEntry {
  path: string
  mtime: string | null
}

export interface VaultConfig {
  version: number
  fonts: { display: string; body: string; mono: string }
  workspaces: string[]
  createdAt: string
  compile?: {
    outputDir?: string // default: 'compiled/'
    persistenceEnabled?: boolean // default: true
  }
  cluster?: {
    outputDir?: string // default: 'clusters/'
    captureEnabled?: boolean // default: true
  }
}

export interface UiPersistedState {
  backlinkCollapsed: Record<string, boolean>
  dismissedGhosts: readonly string[]
  outlineVisible: boolean
  bookmarkedPaths: readonly string[]
}

export interface VaultState {
  version: number
  lastOpenNote: string | null
  panelLayout: { sidebarWidth: number }
  contentView: 'editor' | 'canvas' | 'skills'
  fileTreeCollapseState: Record<string, boolean>
  selectedNodeId: string | null
  recentFiles: string[]
  ui?: UiPersistedState
}
