import type {
  OntologySnapshot,
  OntologyLayoutResult,
  OntologyGroupNode,
  GroupFrame,
  GroupId,
  InterGroupEdge
} from './ontology-types'
import {
  GROUP_PADDING,
  SUBGROUP_PADDING,
  HEADER_HEIGHT,
  SUBGROUP_HEADER,
  CARD_GAP,
  SUBGROUP_GAP,
  GROUP_GAP_MIN
} from './ontology-types'

// --- Internal types ---

interface CardSize {
  readonly width: number
  readonly height: number
}

interface Position {
  readonly x: number
  readonly y: number
}

const MAX_COLUMNS = 3
const DEFAULT_CARD_SIZE: CardSize = { width: 200, height: 100 }

// --- Public API ---

/**
 * Pure function: computes deterministic positions for all cards and group frames
 * from an OntologySnapshot.
 *
 * Algorithm:
 * 1. Rank root groups by total inter-group edge weight (desc), alphabetical tiebreak
 * 2. Place anchor (first ranked group) at origin
 * 3. Place remaining groups in a horizontal row with GROUP_GAP_MIN spacing
 * 4. Within each group: lay out cards in a column grid (max 3 cols)
 * 5. Compute group frame from card positions + padding + header
 * 6. Return OntologyLayoutResult with cardPositions and groupFrames
 */
export function computeOntologyLayout(
  snapshot: OntologySnapshot,
  cardSizes: Readonly<Record<string, CardSize>>,
  origin: { readonly x: number; readonly y: number }
): OntologyLayoutResult {
  const cardPositions: Record<string, Position> = {}
  const groupFrames: Record<string, GroupFrame> = {}

  if (snapshot.rootGroupIds.length === 0) {
    return {
      snapshotRevisionId: snapshot.revisionId,
      cardPositions,
      groupFrames
    }
  }

  // Step 1: Rank root groups
  const rankedGroupIds = rankRootGroups(
    snapshot.rootGroupIds,
    snapshot.groupsById,
    snapshot.interGroupEdges
  )

  // Step 2-3: Place groups in a horizontal row
  let cursorX = origin.x

  for (const gId of rankedGroupIds) {
    const group = snapshot.groupsById[gId]
    if (!group) continue

    // Find child groups (groups whose parentGroupId matches this group)
    const childGroups = findChildGroups(gId, snapshot.groupsById)

    // Lay out cards + child groups within this root group
    const { positions, frame } = layoutGroup(
      group,
      childGroups,
      snapshot.groupsById,
      cardSizes,
      { x: cursorX, y: origin.y },
      true
    )

    // Merge card positions
    for (const [cardId, pos] of Object.entries(positions)) {
      cardPositions[cardId] = pos
    }

    // Store root group frame
    groupFrames[gId] = frame

    // Store child group frames
    for (const child of childGroups) {
      const childFrame = layoutChildGroupFrame(child, cardSizes, frame, positions)
      if (childFrame) {
        groupFrames[child.id] = childFrame
      }
    }

    // Advance cursor past this group + gap
    cursorX = frame.x + frame.width + GROUP_GAP_MIN
  }

  return {
    snapshotRevisionId: snapshot.revisionId,
    cardPositions,
    groupFrames
  }
}

// --- Group ranking ---

function rankRootGroups(
  rootGroupIds: readonly GroupId[],
  groupsById: Readonly<Record<string, OntologyGroupNode>>,
  interGroupEdges: readonly InterGroupEdge[]
): readonly GroupId[] {
  // Compute total edge weight per group
  const weightByGroup = new Map<string, number>()
  for (const gId of rootGroupIds) {
    weightByGroup.set(gId, 0)
  }
  for (const edge of interGroupEdges) {
    const fromWeight = weightByGroup.get(edge.fromGroupId) ?? 0
    const toWeight = weightByGroup.get(edge.toGroupId) ?? 0
    weightByGroup.set(edge.fromGroupId, fromWeight + edge.weight)
    weightByGroup.set(edge.toGroupId, toWeight + edge.weight)
  }

  // Sort: weight desc, then alphabetical by label asc
  const sorted = [...rootGroupIds].sort((a, b) => {
    const wa = weightByGroup.get(a) ?? 0
    const wb = weightByGroup.get(b) ?? 0
    if (wb !== wa) return wb - wa

    const la = groupsById[a]?.label ?? ''
    const lb = groupsById[b]?.label ?? ''
    return la.localeCompare(lb)
  })

  return sorted
}

// --- Child group discovery ---

function findChildGroups(
  parentId: GroupId,
  groupsById: Readonly<Record<string, OntologyGroupNode>>
): readonly OntologyGroupNode[] {
  const children: OntologyGroupNode[] = []
  for (const group of Object.values(groupsById)) {
    if (group.parentGroupId === parentId) {
      children.push(group)
    }
  }
  // Sort children alphabetically for determinism
  return children.sort((a, b) => a.label.localeCompare(b.label))
}

// --- Group layout ---

interface GroupLayoutResult {
  readonly positions: Record<string, Position>
  readonly frame: GroupFrame
}

function layoutGroup(
  group: OntologyGroupNode,
  childGroups: readonly OntologyGroupNode[],
  groupsById: Readonly<Record<string, OntologyGroupNode>>,
  cardSizes: Readonly<Record<string, CardSize>>,
  topLeft: Position,
  isRoot: boolean
): GroupLayoutResult {
  const padding = isRoot ? GROUP_PADDING : SUBGROUP_PADDING
  const headerHeight = isRoot ? HEADER_HEIGHT : SUBGROUP_HEADER
  const positions: Record<string, Position> = {}

  // Content area starts after padding + header
  const contentX = topLeft.x + padding
  const contentY = topLeft.y + padding + headerHeight

  // Lay out this group's direct cards in a column grid
  const directCardIds = group.cardIds
  const { positions: cardPositions, bounds: cardBounds } = layoutCardsInGrid(
    directCardIds,
    cardSizes,
    { x: contentX, y: contentY }
  )

  for (const [cardId, pos] of Object.entries(cardPositions)) {
    positions[cardId] = pos
  }

  // Track total content bounds
  let contentWidth = cardBounds.width
  let contentBottom = cardBounds.height > 0 ? contentY + cardBounds.height : contentY

  // Lay out child groups below cards
  if (childGroups.length > 0) {
    let childY = contentBottom + (cardBounds.height > 0 ? SUBGROUP_GAP : 0)

    for (const child of childGroups) {
      const grandChildren = findChildGroups(child.id, groupsById)
      const childResult = layoutGroup(
        child,
        grandChildren,
        groupsById,
        cardSizes,
        { x: contentX, y: childY },
        false
      )

      for (const [cardId, pos] of Object.entries(childResult.positions)) {
        positions[cardId] = pos
      }

      contentWidth = Math.max(contentWidth, childResult.frame.width)
      childY = childResult.frame.y + childResult.frame.height + SUBGROUP_GAP
    }

    contentBottom = childY - SUBGROUP_GAP
  }

  // Compute frame dimensions
  const frameWidth = Math.max(contentWidth + padding * 2, padding * 2)
  const frameHeight = Math.max(contentBottom - topLeft.y + padding, padding * 2 + headerHeight)

  const frame: GroupFrame = {
    groupId: group.id,
    x: topLeft.x,
    y: topLeft.y,
    width: frameWidth,
    height: frameHeight,
    padding,
    isRoot
  }

  return { positions, frame }
}

// --- Card grid layout ---

interface GridResult {
  readonly positions: Record<string, Position>
  readonly bounds: { readonly width: number; readonly height: number }
}

function layoutCardsInGrid(
  cardIds: readonly string[],
  cardSizes: Readonly<Record<string, CardSize>>,
  topLeft: Position
): GridResult {
  if (cardIds.length === 0) {
    return { positions: {}, bounds: { width: 0, height: 0 } }
  }

  const positions: Record<string, Position> = {}
  const numCols = Math.min(cardIds.length, MAX_COLUMNS)

  // Compute column widths (max width of cards in each column)
  const columnWidths: number[] = new Array(numCols).fill(0)
  for (let i = 0; i < cardIds.length; i++) {
    const col = i % numCols
    const size = cardSizes[cardIds[i]] ?? DEFAULT_CARD_SIZE
    columnWidths[col] = Math.max(columnWidths[col], size.width)
  }

  // Compute row heights (max height of cards in each row)
  const numRows = Math.ceil(cardIds.length / numCols)
  const rowHeights: number[] = new Array(numRows).fill(0)
  for (let i = 0; i < cardIds.length; i++) {
    const row = Math.floor(i / numCols)
    const size = cardSizes[cardIds[i]] ?? DEFAULT_CARD_SIZE
    rowHeights[row] = Math.max(rowHeights[row], size.height)
  }

  // Place cards
  for (let i = 0; i < cardIds.length; i++) {
    const col = i % numCols
    const row = Math.floor(i / numCols)

    // X: sum of previous column widths + gaps
    let x = topLeft.x
    for (let c = 0; c < col; c++) {
      x += columnWidths[c] + CARD_GAP
    }

    // Y: sum of previous row heights + gaps
    let y = topLeft.y
    for (let r = 0; r < row; r++) {
      y += rowHeights[r] + CARD_GAP
    }

    positions[cardIds[i]] = { x, y }
  }

  // Total bounds
  const totalWidth = columnWidths.reduce((sum, w, i) => sum + w + (i > 0 ? CARD_GAP : 0), 0)
  const totalHeight = rowHeights.reduce((sum, h, i) => sum + h + (i > 0 ? CARD_GAP : 0), 0)

  return { positions, bounds: { width: totalWidth, height: totalHeight } }
}

// --- Child group frame computation ---

function layoutChildGroupFrame(
  child: OntologyGroupNode,
  cardSizes: Readonly<Record<string, CardSize>>,
  _parentFrame: GroupFrame,
  allPositions: Record<string, Position>
): GroupFrame | null {
  // Find bounds of all cards belonging to this child group
  const childCardIds = child.cardIds
  if (childCardIds.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const cardId of childCardIds) {
    const pos = allPositions[cardId]
    if (!pos) continue
    const size = cardSizes[cardId] ?? DEFAULT_CARD_SIZE
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + size.width)
    maxY = Math.max(maxY, pos.y + size.height)
  }

  if (minX === Infinity) return null

  return {
    groupId: child.id,
    x: minX - SUBGROUP_PADDING,
    y: minY - SUBGROUP_PADDING - SUBGROUP_HEADER,
    width: maxX - minX + SUBGROUP_PADDING * 2,
    height: maxY - minY + SUBGROUP_PADDING * 2 + SUBGROUP_HEADER,
    padding: SUBGROUP_PADDING,
    isRoot: false
  }
}
