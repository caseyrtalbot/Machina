// --- Branded types ---

export type GroupId = string & { readonly __brand: 'GroupId' }
export function groupId(id: string): GroupId {
  return id as GroupId
}

export type RevisionId = string & { readonly __brand: 'RevisionId' }
export function revisionId(id: string): RevisionId {
  return id as RevisionId
}

// --- Constants ---

export const MAX_GROUP_DEPTH = 2
export const LINK_CLUSTER_MIN_SIZE = 3

export const ONTOLOGY_COLOR_TOKENS = [
  'ontology-green',
  'ontology-blue',
  'ontology-orange',
  'ontology-purple',
  'ontology-yellow',
  'ontology-red',
  'ontology-teal',
  'ontology-indigo'
] as const

export type OntologyColorToken = (typeof ONTOLOGY_COLOR_TOKENS)[number]

// --- Provenance ---

export type GroupProvenance =
  | { readonly kind: 'user-tag'; readonly tagPaths: readonly string[] }
  | {
      readonly kind: 'link-analysis'
      readonly algorithm: string
      readonly confidence: number
    }
  | {
      readonly kind: 'ai-inference'
      readonly agentId: string
      readonly runId: string
      readonly model: string
      readonly confidence: number
      readonly reasoning: string
    }
  | {
      readonly kind: 'hybrid'
      readonly strategy: string
      readonly confidence: number
    }

// --- Semantic Layer ---

export interface OntologyGroupNode {
  readonly id: GroupId
  readonly label: string
  readonly parentGroupId: GroupId | null
  readonly colorToken: string
  readonly cardIds: readonly string[]
  readonly provenance: GroupProvenance
}

export interface InterGroupEdge {
  readonly fromGroupId: GroupId
  readonly toGroupId: GroupId
  readonly weight: number
  readonly kindDistribution: Readonly<Record<string, number>>
}

export interface OntologySnapshot {
  readonly revisionId: RevisionId
  readonly createdAt: string
  readonly rootGroupIds: readonly GroupId[]
  readonly groupsById: Readonly<Record<string, OntologyGroupNode>>
  readonly ungroupedNoteIds: readonly string[]
  readonly auxiliaryCardIds: readonly string[]
  readonly interGroupEdges: readonly InterGroupEdge[]
}

// --- Geometry Layer ---

export interface GroupFrame {
  readonly groupId: GroupId
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly padding: number
  readonly isRoot: boolean
}

export interface OntologyLayoutResult {
  readonly snapshotRevisionId: RevisionId
  readonly cardPositions: Readonly<Record<string, { x: number; y: number }>>
  readonly groupFrames: Readonly<Record<string, GroupFrame>>
}

// --- Layout Constants ---

export const GROUP_PADDING = 32
export const SUBGROUP_PADDING = 20
export const HEADER_HEIGHT = 48
export const SUBGROUP_HEADER = 32
export const CARD_GAP = 24
export const SUBGROUP_GAP = 16
export const GROUP_GAP_MIN = 120

// --- Edge weight table ---

export const EDGE_WEIGHT_TABLE: Readonly<Record<string, number>> = {
  connection: 3,
  cluster: 3,
  tension: 2,
  related: 2,
  appears_in: 0,
  'co-occurrence': 0
}
