import type {
  GroupId,
  OntologySnapshot,
  OntologyGroupNode,
  InterGroupEdge,
  OntologyColorToken
} from './ontology-types'
import {
  groupId,
  revisionId,
  MAX_GROUP_DEPTH,
  ONTOLOGY_COLOR_TOKENS,
  EDGE_WEIGHT_TABLE,
  LINK_CLUSTER_MIN_SIZE
} from './ontology-types'

// --- Input types ---

interface OntologyGroupingInput {
  readonly cards: readonly {
    readonly id: string
    readonly type: string
    readonly content: string
  }[]
  readonly fileToId: Readonly<Record<string, string>>
  readonly artifacts: Readonly<
    Record<
      string,
      {
        readonly id: string
        readonly tags: readonly string[]
        readonly bodyLinks: readonly string[]
        readonly connections: readonly string[]
        readonly concepts: readonly string[]
        readonly title: string
        readonly origin?: 'human' | 'source' | 'agent'
      }
    >
  >
  readonly graphEdges: readonly {
    readonly source: string
    readonly target: string
    readonly kind: string
  }[]
}

// --- Internal types ---

interface ResolvedCard {
  readonly cardId: string
  readonly artifactId: string
  readonly tags: readonly string[]
}

interface TagScore {
  readonly tag: string
  readonly score: number
}

interface MutableGroupBuilder {
  readonly id: GroupId
  readonly label: string
  readonly parentGroupId: GroupId | null
  readonly tagPaths: string[]
  readonly cardIds: string[]
}

// --- Deterministic hash (djb2) ---

function computeRevisionHash(
  cardIds: readonly string[],
  tags: readonly (readonly string[])[],
  links: readonly (readonly string[])[]
): string {
  const sorted = [...cardIds].sort()
  const input = JSON.stringify({ cardIds: sorted, tags, links })
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff
  }
  return hash.toString(36)
}

// --- Step 0: Resolve cards to artifacts ---

function resolveCards(input: OntologyGroupingInput): {
  readonly resolved: readonly ResolvedCard[]
  readonly ungroupedNoteIds: readonly string[]
  readonly auxiliaryCardIds: readonly string[]
  readonly canvasArtifactIds: ReadonlySet<string>
} {
  const resolved: ResolvedCard[] = []
  const ungroupedNoteIds: string[] = []
  const auxiliaryCardIds: string[] = []
  const canvasArtifactIds = new Set<string>()

  for (const card of input.cards) {
    if (card.type !== 'note') {
      auxiliaryCardIds.push(card.id)
      continue
    }

    // Try to resolve note card to an artifact via fileToId
    const artifactId = input.fileToId[card.content]
    if (!artifactId) {
      ungroupedNoteIds.push(card.id)
      continue
    }

    const artifact = input.artifacts[artifactId]
    if (!artifact) {
      ungroupedNoteIds.push(card.id)
      continue
    }

    canvasArtifactIds.add(artifactId)

    if (artifact.tags.length === 0) {
      ungroupedNoteIds.push(card.id)
      continue
    }

    resolved.push({
      cardId: card.id,
      artifactId,
      tags: artifact.tags
    })
  }

  return { resolved, ungroupedNoteIds, auxiliaryCardIds, canvasArtifactIds }
}

// --- Step 2: Primary tag grouping ---

function getTopLevelTag(tag: string): string {
  const slashIndex = tag.indexOf('/')
  return slashIndex === -1 ? tag : tag.substring(0, slashIndex)
}

function computeCanvasTagFrequency(resolved: readonly ResolvedCard[]): ReadonlyMap<string, number> {
  const frequency = new Map<string, number>()
  for (const card of resolved) {
    for (const tag of card.tags) {
      const topLevel = getTopLevelTag(tag)
      frequency.set(topLevel, (frequency.get(topLevel) ?? 0) + 1)
    }
  }
  return frequency
}

function scoreTagForCard(
  tag: string,
  canvasFrequency: ReadonlyMap<string, number>,
  neighborTagCounts: ReadonlyMap<string, number>
): number {
  const topLevel = getTopLevelTag(tag)
  let score = 0

  // Factor 1: Neighbor frequency (+2 per graph neighbor sharing this top-level tag)
  score += (neighborTagCounts.get(topLevel) ?? 0) * 2

  // Factor 2: Depth bonus (+1 per tag path segment)
  score += tag.split('/').length

  // Factor 3: Canvas frequency (+1 per canvas artifact with this top-level tag)
  score += canvasFrequency.get(topLevel) ?? 0

  return score
}

/**
 * For a given card's artifact, count how many of its graph neighbors
 * share each top-level tag. Returns map: topLevelTag -> count.
 */
function computeNeighborTagCounts(
  artifactId: string,
  input: OntologyGroupingInput,
  canvasArtifactIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  // Find all graph neighbors of this artifact that are on canvas
  for (const edge of input.graphEdges) {
    let neighborId: string | null = null
    if (edge.source === artifactId && canvasArtifactIds.has(edge.target)) {
      neighborId = edge.target
    } else if (edge.target === artifactId && canvasArtifactIds.has(edge.source)) {
      neighborId = edge.source
    }
    if (!neighborId) continue

    const neighbor = input.artifacts[neighborId]
    if (!neighbor) continue

    for (const neighborTag of neighbor.tags) {
      const topLevel = getTopLevelTag(neighborTag)
      counts.set(topLevel, (counts.get(topLevel) ?? 0) + 1)
    }
  }

  return counts
}

function assignPrimaryTags(
  resolved: readonly ResolvedCard[],
  canvasArtifactIds: ReadonlySet<string>,
  input: OntologyGroupingInput
): ReadonlyMap<string, { readonly topLevelTag: string; readonly fullTag: string }> {
  const canvasFrequency = computeCanvasTagFrequency(resolved)
  const assignments = new Map<string, { topLevelTag: string; fullTag: string }>()

  for (const card of resolved) {
    if (card.tags.length === 1) {
      const tag = card.tags[0]
      assignments.set(card.cardId, {
        topLevelTag: getTopLevelTag(tag),
        fullTag: tag
      })
      continue
    }

    // Multi-tag: score each and pick highest
    const neighborTagCounts = computeNeighborTagCounts(card.artifactId, input, canvasArtifactIds)
    const scored: TagScore[] = card.tags.map((tag) => ({
      tag,
      score: scoreTagForCard(tag, canvasFrequency, neighborTagCounts)
    }))

    // Sort by score descending, then alphabetically for tiebreak
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.tag.localeCompare(b.tag)
    })

    const bestTag = scored[0].tag
    assignments.set(card.cardId, {
      topLevelTag: getTopLevelTag(bestTag),
      fullTag: bestTag
    })
  }

  return assignments
}

// --- Step 3: Sub-grouping by nested tags ---

/**
 * Parse a full tag path into [rootTag, subTag?], enforcing MAX_GROUP_DEPTH.
 *
 * - "systems" -> ["systems", null]
 * - "systems/feedback" -> ["systems", "feedback"]
 * - "systems/feedback/positive" -> ["systems", "feedback/positive"]  (flattened)
 *
 * MAX_GROUP_DEPTH = 2 means root (depth 1) + one child (depth 2).
 * Everything beyond depth 2 is collapsed into the child label.
 */
function parseTagPath(fullTag: string): { root: string; sub: string | null } {
  const segments = fullTag.split('/')
  const root = segments[0]

  if (segments.length <= 1) {
    return { root, sub: null }
  }

  // MAX_GROUP_DEPTH controls how many nesting levels are allowed.
  // Depth 1 = root group, depth 2 = one child level.
  // Segments beyond (MAX_GROUP_DEPTH - 1) get collapsed into a single child label.
  const maxChildSegments = MAX_GROUP_DEPTH - 1
  const childSegments = segments.slice(1)

  if (childSegments.length <= maxChildSegments) {
    return { root, sub: childSegments.join('/') }
  }

  // Flatten: join all remaining segments into one sub-label
  return { root, sub: childSegments.join('/') }
}

function buildGroups(
  assignments: ReadonlyMap<string, { readonly topLevelTag: string; readonly fullTag: string }>,
  resolved: readonly ResolvedCard[]
): {
  readonly groupBuilders: ReadonlyMap<string, MutableGroupBuilder>
  readonly rootGroupKeys: readonly string[]
} {
  // First pass: collect all top-level tags and sub-tags
  const rootGroups = new Map<string, MutableGroupBuilder>()
  const childGroups = new Map<string, MutableGroupBuilder>()

  // Create root groups for each unique top-level tag
  const topLevelTags = new Set<string>()
  for (const [, assignment] of assignments) {
    topLevelTags.add(assignment.topLevelTag)
  }

  for (const topLevel of topLevelTags) {
    const id = groupId(`tag:${topLevel}`)
    rootGroups.set(topLevel, {
      id,
      label: topLevel,
      parentGroupId: null,
      tagPaths: [],
      cardIds: []
    })
  }

  // Second pass: assign cards to groups, creating child groups as needed
  for (const card of resolved) {
    const assignment = assignments.get(card.cardId)
    if (!assignment) continue

    const rootGroup = rootGroups.get(assignment.topLevelTag)
    if (!rootGroup) continue

    const parsed = parseTagPath(assignment.fullTag)

    if (!parsed.sub) {
      // No sub-tag: card goes directly in root group
      rootGroup.cardIds.push(card.cardId)
      if (!rootGroup.tagPaths.includes(assignment.fullTag)) {
        rootGroup.tagPaths.push(assignment.fullTag)
      }
    } else {
      // Has sub-tag: card goes into a child group (flattened per MAX_GROUP_DEPTH)
      const childKey = `${parsed.root}/${parsed.sub}`

      let childGroup = childGroups.get(childKey)
      if (!childGroup) {
        const childId = groupId(`tag:${childKey}`)
        childGroup = {
          id: childId,
          label: parsed.sub,
          parentGroupId: rootGroup.id,
          tagPaths: [],
          cardIds: []
        }
        childGroups.set(childKey, childGroup)
      }

      childGroup.cardIds.push(card.cardId)
      if (!childGroup.tagPaths.includes(assignment.fullTag)) {
        childGroup.tagPaths.push(assignment.fullTag)
      }

      // Also ensure the root group tracks this tag path
      if (!rootGroup.tagPaths.includes(assignment.topLevelTag)) {
        rootGroup.tagPaths.push(assignment.topLevelTag)
      }
    }
  }

  // Merge all groups
  const allGroups = new Map<string, MutableGroupBuilder>()
  for (const [key, group] of rootGroups) {
    allGroups.set(key, group)
  }
  for (const [key, group] of childGroups) {
    allGroups.set(key, group)
  }

  return {
    groupBuilders: allGroups,
    rootGroupKeys: [...topLevelTags]
  }
}

// --- Step 4: Link-based sub-grouping ---

/**
 * Get the effective weight for a graph edge kind from EDGE_WEIGHT_TABLE.
 * Unknown kinds get weight 0 (ignored).
 */
function edgeWeight(kind: string): number {
  return EDGE_WEIGHT_TABLE[kind] ?? 0
}

/**
 * Build a weighted undirected adjacency map for a set of artifact IDs.
 * Only includes edges where both endpoints are in the given set and weight >= 2.
 */
function buildWeightedAdjacency(
  artifactIds: ReadonlySet<string>,
  graphEdges: OntologyGroupingInput['graphEdges']
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const adj = new Map<string, Map<string, number>>()

  for (const edge of graphEdges) {
    if (!artifactIds.has(edge.source) || !artifactIds.has(edge.target)) continue
    if (edge.source === edge.target) continue

    const weight = edgeWeight(edge.kind)
    if (weight < 2) continue

    // Undirected: add both directions
    const [a, b] =
      edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source]

    if (!adj.has(a)) adj.set(a, new Map())
    if (!adj.has(b)) adj.set(b, new Map())

    const aMap = adj.get(a)!
    const bMap = adj.get(b)!

    // Take max weight if multiple edge kinds connect the same pair
    aMap.set(b, Math.max(aMap.get(b) ?? 0, weight))
    bMap.set(a, Math.max(bMap.get(a) ?? 0, weight))
  }

  return adj
}

/**
 * Find connected components in the weighted adjacency graph.
 * Returns arrays of artifact IDs, each representing a component.
 */
function findConnectedComponents(
  adj: ReadonlyMap<string, ReadonlyMap<string, number>>
): readonly (readonly string[])[] {
  const visited = new Set<string>()
  const components: string[][] = []

  for (const node of adj.keys()) {
    if (visited.has(node)) continue

    const component: string[] = []
    const stack = [node]

    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      component.push(current)

      const neighbors = adj.get(current)
      if (neighbors) {
        for (const neighbor of neighbors.keys()) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor)
          }
        }
      }
    }

    components.push(component)
  }

  return components
}

/**
 * Choose a label for a link-based cluster.
 * Fallback cascade: most-connected card's title + " cluster" -> "Linked cluster"
 */
function chooseLinkClusterLabel(
  artifactIds: readonly string[],
  adj: ReadonlyMap<string, ReadonlyMap<string, number>>,
  artifacts: OntologyGroupingInput['artifacts']
): string {
  // Find the most-connected artifact (by number of weighted neighbors)
  let bestId = artifactIds[0]
  let bestDegree = 0

  for (const id of artifactIds) {
    const neighbors = adj.get(id)
    const degree = neighbors ? neighbors.size : 0
    if (degree > bestDegree || (degree === bestDegree && id < bestId)) {
      bestDegree = degree
      bestId = id
    }
  }

  const artifact = artifacts[bestId]
  if (artifact && artifact.title) {
    return `${artifact.title} cluster`
  }

  return 'Linked cluster'
}

/**
 * Step 4: Within each root group, find clusters of heavily-linked cards
 * that are not already in a child group. Create child groups for them.
 */
function applyLinkBasedSubGrouping(
  groupBuilders: ReadonlyMap<string, MutableGroupBuilder>,
  rootGroupKeys: readonly string[],
  resolved: readonly ResolvedCard[],
  input: OntologyGroupingInput
): ReadonlyMap<string, MutableGroupBuilder> {
  // Build cardId -> artifactId map
  const cardToArtifact = new Map<string, string>()
  for (const card of resolved) {
    cardToArtifact.set(card.cardId, card.artifactId)
  }

  // Collect all card IDs that are already in child groups
  const cardsInChildGroups = new Set<string>()
  for (const [, builder] of groupBuilders) {
    if (builder.parentGroupId !== null) {
      for (const cardId of builder.cardIds) {
        cardsInChildGroups.add(cardId)
      }
    }
  }

  // New groups to add
  const newGroups = new Map<string, MutableGroupBuilder>()

  for (const rootKey of rootGroupKeys) {
    const rootBuilder = groupBuilders.get(rootKey)
    if (!rootBuilder) continue

    // Get cards directly in the root group (not in any child group)
    // These are the candidates for link clustering
    const candidateCardIds = rootBuilder.cardIds.filter((cid) => !cardsInChildGroups.has(cid))
    if (candidateCardIds.length < LINK_CLUSTER_MIN_SIZE) continue

    // Map candidate cards to artifact IDs
    const candidateArtifactIds = new Set<string>()
    const artifactToCard = new Map<string, string>()
    for (const cardId of candidateCardIds) {
      const artifactId = cardToArtifact.get(cardId)
      if (artifactId) {
        candidateArtifactIds.add(artifactId)
        artifactToCard.set(artifactId, cardId)
      }
    }

    // Build weighted adjacency for these candidates
    const adj = buildWeightedAdjacency(candidateArtifactIds, input.graphEdges)

    // Find connected components
    const components = findConnectedComponents(adj)

    // Create child groups for components meeting minimum size
    for (const component of components) {
      if (component.length < LINK_CLUSTER_MIN_SIZE) continue

      const clusterCardIds = component
        .map((artifactId) => artifactToCard.get(artifactId))
        .filter((cid): cid is string => cid !== undefined)
        .sort()

      if (clusterCardIds.length < LINK_CLUSTER_MIN_SIZE) continue

      const label = chooseLinkClusterLabel(component, adj, input.artifacts)
      const sortedComponent = [...component].sort()
      const id = groupId(`link:${sortedComponent.join(',')}`)

      newGroups.set(id, {
        id,
        label,
        parentGroupId: rootBuilder.id,
        tagPaths: [],
        cardIds: clusterCardIds
      })

      // Remove these cards from the root group
      const clusterSet = new Set(clusterCardIds)
      const remaining = rootBuilder.cardIds.filter((cid) => !clusterSet.has(cid))
      rootBuilder.cardIds.length = 0
      rootBuilder.cardIds.push(...remaining)
    }
  }

  // Merge new groups into builders
  const merged = new Map(groupBuilders)
  for (const [key, group] of newGroups) {
    merged.set(key, group)
  }

  return merged
}

// --- Step 5: Inter-group edges ---

function computeInterGroupEdges(
  input: OntologyGroupingInput,
  artifactToRootGroupId: ReadonlyMap<string, GroupId>
): readonly InterGroupEdge[] {
  // Build edge key -> accumulated data
  const edgeMap = new Map<
    string,
    { fromGroupId: GroupId; toGroupId: GroupId; kindCounts: Map<string, number> }
  >()

  // Filter graph edges to canvas-relevant subset
  for (const edge of input.graphEdges) {
    const fromGroup = artifactToRootGroupId.get(edge.source)
    const toGroup = artifactToRootGroupId.get(edge.target)

    if (!fromGroup || !toGroup) continue
    if (fromGroup === toGroup) continue

    // Normalize edge key (smaller id first for consistency)
    const [gA, gB] = fromGroup < toGroup ? [fromGroup, toGroup] : [toGroup, fromGroup]
    const key = `${gA}::${gB}`

    let entry = edgeMap.get(key)
    if (!entry) {
      entry = { fromGroupId: gA, toGroupId: gB, kindCounts: new Map() }
      edgeMap.set(key, entry)
    }

    entry.kindCounts.set(edge.kind, (entry.kindCounts.get(edge.kind) ?? 0) + 1)
  }

  // Convert to InterGroupEdge array
  const edges: InterGroupEdge[] = []
  for (const [, entry] of edgeMap) {
    const kindDistribution: Record<string, number> = {}
    let weight = 0
    for (const [kind, count] of entry.kindCounts) {
      kindDistribution[kind] = count
      weight += count
    }

    edges.push({
      fromGroupId: entry.fromGroupId,
      toGroupId: entry.toGroupId,
      weight,
      kindDistribution
    })
  }

  return edges
}

// --- Step 6: Assembly ---

function assignColorTokens(
  rootGroupIds: readonly GroupId[],
  groupsById: ReadonlyMap<string, MutableGroupBuilder>
): ReadonlyMap<GroupId, OntologyColorToken> {
  // Sort root groups alphabetically by label
  const rootGroups = rootGroupIds
    .map((id) => {
      // Find the builder with this id
      for (const [, builder] of groupsById) {
        if (builder.id === id) return builder
      }
      return null
    })
    .filter((g): g is MutableGroupBuilder => g !== null)

  const sorted = [...rootGroups].sort((a, b) => a.label.localeCompare(b.label))

  const colorMap = new Map<GroupId, OntologyColorToken>()
  for (let i = 0; i < sorted.length; i++) {
    const token = ONTOLOGY_COLOR_TOKENS[i % ONTOLOGY_COLOR_TOKENS.length]
    colorMap.set(sorted[i].id, token)
  }

  return colorMap
}

// --- Origin-based grouping ---

const ORIGIN_LABELS: Record<string, string> = {
  human: 'Human',
  source: 'Sources',
  agent: 'Agent-Compiled'
}

const ORIGIN_COLORS: Record<string, OntologyColorToken> = {
  human: 'ontology-blue',
  source: 'ontology-orange',
  agent: 'ontology-green'
}

function groupByOrigin(input: OntologyGroupingInput): OntologySnapshot {
  const groups = new Map<string, string[]>()

  for (const card of input.cards) {
    if (card.type !== 'note') continue
    const artifactId = input.fileToId[card.content]
    if (!artifactId) continue
    const artifact = input.artifacts[artifactId]
    if (!artifact) continue
    const origin = artifact.origin ?? 'human'
    const list = groups.get(origin) ?? []
    list.push(card.id)
    groups.set(origin, list)
  }

  const groupsById: Record<string, OntologyGroupNode> = {}
  const rootGroupIds: GroupId[] = []

  for (const [origin, cardIds] of groups) {
    if (cardIds.length === 0) continue
    const id = groupId(`origin:${origin}`)
    rootGroupIds.push(id)
    groupsById[id] = {
      id,
      label: ORIGIN_LABELS[origin] ?? origin,
      parentGroupId: null,
      colorToken: ORIGIN_COLORS[origin] ?? ONTOLOGY_COLOR_TOKENS[0],
      cardIds,
      provenance: { kind: 'user-tag', tagPaths: [`origin:${origin}`] }
    }
  }

  const rev = computeRevisionHash(
    input.cards.map((c) => c.id),
    [],
    []
  )

  return {
    revisionId: revisionId(rev),
    createdAt: new Date().toISOString(),
    rootGroupIds,
    groupsById,
    ungroupedNoteIds: [],
    auxiliaryCardIds: input.cards.filter((c) => c.type !== 'note').map((c) => c.id),
    interGroupEdges: []
  }
}

type OntologyGroupBy = 'tags' | 'origin'

// --- Main function ---

export function computeOntologySnapshot(
  input: OntologyGroupingInput,
  groupBy: OntologyGroupBy = 'tags'
): OntologySnapshot {
  if (groupBy === 'origin') {
    return groupByOrigin(input)
  }
  // Step 0: Resolve cards to artifacts
  const { resolved, ungroupedNoteIds, auxiliaryCardIds, canvasArtifactIds } = resolveCards(input)

  // Early return for empty input
  if (resolved.length === 0) {
    const rev = computeRevisionHash([], [], [])
    return {
      revisionId: revisionId(rev),
      createdAt: new Date().toISOString(),
      rootGroupIds: [],
      groupsById: {},
      ungroupedNoteIds,
      auxiliaryCardIds,
      interGroupEdges: []
    }
  }

  // Step 2: Primary tag grouping
  const assignments = assignPrimaryTags(resolved, canvasArtifactIds, input)

  // Step 3: Sub-grouping by nested tags
  const { groupBuilders: tagGroupBuilders, rootGroupKeys } = buildGroups(assignments, resolved)

  // Step 4: Link-based sub-grouping
  const groupBuilders = applyLinkBasedSubGrouping(tagGroupBuilders, rootGroupKeys, resolved, input)

  // Build artifact -> root group id map for inter-group edges
  const artifactToRootGroupId = new Map<string, GroupId>()
  for (const card of resolved) {
    const assignment = assignments.get(card.cardId)
    if (!assignment) continue
    const rootBuilder = groupBuilders.get(assignment.topLevelTag)
    if (rootBuilder) {
      artifactToRootGroupId.set(card.artifactId, rootBuilder.id)
    }
  }

  // Collect root group ids
  const rootGroupIds: GroupId[] = rootGroupKeys
    .map((key) => groupBuilders.get(key)?.id)
    .filter((id): id is GroupId => id !== undefined)

  // Step 5: Inter-group edges
  const interGroupEdges = computeInterGroupEdges(input, artifactToRootGroupId)

  // Step 6: Assembly - assign colors
  const colorMap = assignColorTokens(rootGroupIds, groupBuilders)

  // Build final groupsById
  const groupsById: Record<string, OntologyGroupNode> = {}
  for (const [, builder] of groupBuilders) {
    const parentColor =
      builder.parentGroupId !== null
        ? // Find the parent's color
          colorMap.get(
            // Walk up to root
            [...groupBuilders.values()].find((g) => g.id === builder.parentGroupId)?.id ??
              builder.parentGroupId
          )
        : undefined

    const colorToken = colorMap.get(builder.id) ?? parentColor ?? ONTOLOGY_COLOR_TOKENS[0]

    const isLinkGroup = builder.id.startsWith('link:')
    const provenance: OntologyGroupNode['provenance'] = isLinkGroup
      ? { kind: 'link-analysis' as const, algorithm: 'weighted-components', confidence: 0.8 }
      : {
          kind: 'user-tag' as const,
          tagPaths: builder.tagPaths.length > 0 ? builder.tagPaths : [builder.label]
        }

    groupsById[builder.id] = {
      id: builder.id,
      label: builder.label,
      parentGroupId: builder.parentGroupId,
      colorToken,
      cardIds: builder.cardIds,
      provenance
    }
  }

  // Compute revision hash
  const allCardIds = resolved.map((c) => c.cardId)
  const allTags = resolved.map((c) => c.tags)
  const allLinks = resolved.map((c) => {
    const artifact = input.artifacts[c.artifactId]
    return artifact?.bodyLinks ?? []
  })
  const rev = computeRevisionHash(allCardIds, allTags, allLinks)

  return {
    revisionId: revisionId(rev),
    createdAt: new Date().toISOString(),
    rootGroupIds,
    groupsById,
    ungroupedNoteIds,
    auxiliaryCardIds,
    interGroupEdges
  }
}
