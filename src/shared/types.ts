export const ARTIFACT_TYPES = ['gene', 'constraint', 'research', 'output', 'note', 'index'] as const
export type BuiltInArtifactType = (typeof ARTIFACT_TYPES)[number]
export type ArtifactType = string

export function isBuiltInType(t: string): t is BuiltInArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(t)
}

export const SIGNALS = ['untested', 'emerging', 'validated', 'core'] as const
export type Signal = (typeof SIGNALS)[number]

export const TYPE_PREFIXES: Record<ArtifactType, string> = {
  gene: 'g',
  constraint: 'c',
  research: 'r',
  output: 'o',
  note: 'n',
  index: 'i'
}

export const SIGNAL_OPACITY: Record<Signal, number> = {
  core: 1.0,
  validated: 0.85,
  emerging: 0.7,
  untested: 0.4
}

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
  wikilinks: readonly string[]
  body: string
}

export const RELATIONSHIP_KINDS = [
  'connection',
  'cluster',
  'tension',
  'appears_in',
  'wikilink',
  'tag'
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
  contentView: 'graph' | 'editor' | 'skills'
  graphViewport: { x: number; y: number; k: number }
  terminalSessions: string[]
  fileTreeCollapseState: Record<string, boolean>
  selectedNodeId: string | null
  recentFiles: string[]
}
