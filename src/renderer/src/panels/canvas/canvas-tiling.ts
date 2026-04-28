// ---------------------------------------------------------------------------
// Tiling layout engine — pure functions, no side effects
// ---------------------------------------------------------------------------

export type TilePattern = 'split-h' | 'split-v' | 'grid-2x2' | 'main-sidebar' | 'triple'

export const TILE_PATTERNS: readonly {
  readonly id: TilePattern
  readonly label: string
}[] = [
  { id: 'split-h', label: 'Split Horizontal' },
  { id: 'split-v', label: 'Split Vertical' },
  { id: 'grid-2x2', label: 'Grid 2x2' },
  { id: 'main-sidebar', label: 'Main + Sidebar' },
  { id: 'triple', label: 'Triple' }
]

export const TILE_GAP = 20

interface TileCard {
  readonly id: string
  readonly size: { readonly width: number; readonly height: number }
}

// ---------------------------------------------------------------------------
// Pattern slot counts
// ---------------------------------------------------------------------------

function slotCount(pattern: TilePattern): number {
  switch (pattern) {
    case 'split-h':
      return 2
    case 'split-v':
      return 2
    case 'grid-2x2':
      return 4
    case 'main-sidebar':
      return 3
    case 'triple':
      return 3
  }
}

// ---------------------------------------------------------------------------
// Per-pattern layout logic
// ---------------------------------------------------------------------------

function layoutSplitH(
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  if (cards.length === 1) {
    const c = cards[0]
    positions.set(c.id, {
      x: origin.x - c.size.width / 2,
      y: origin.y - c.size.height / 2
    })
    return positions
  }

  const left = cards[0]
  const right = cards[1]
  const totalWidth = left.size.width + TILE_GAP + right.size.width
  const maxHeight = Math.max(left.size.height, right.size.height)
  const startX = origin.x - totalWidth / 2
  const startY = origin.y - maxHeight / 2

  positions.set(left.id, { x: startX, y: startY })
  positions.set(right.id, { x: startX + left.size.width + TILE_GAP, y: startY })

  return positions
}

function layoutSplitV(
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  if (cards.length === 1) {
    const c = cards[0]
    positions.set(c.id, {
      x: origin.x - c.size.width / 2,
      y: origin.y - c.size.height / 2
    })
    return positions
  }

  const top = cards[0]
  const bottom = cards[1]
  const totalHeight = top.size.height + TILE_GAP + bottom.size.height
  const maxWidth = Math.max(top.size.width, bottom.size.width)
  const startX = origin.x - maxWidth / 2
  const startY = origin.y - totalHeight / 2

  positions.set(top.id, { x: startX, y: startY })
  positions.set(bottom.id, { x: startX, y: startY + top.size.height + TILE_GAP })

  return positions
}

function layoutGrid2x2(
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  // For grid layout, compute column and row dimensions from actual card sizes
  // Row 0: cards[0], cards[1]. Row 1: cards[2], cards[3]
  const topLeft = cards[0]
  const topRight = cards.length > 1 ? cards[1] : undefined
  const bottomLeft = cards.length > 2 ? cards[2] : undefined
  const bottomRight = cards.length > 3 ? cards[3] : undefined

  // Column widths: max of top and bottom in each column
  const col0Width = Math.max(topLeft.size.width, bottomLeft?.size.width ?? 0)
  const col1Width = Math.max(topRight?.size.width ?? 0, bottomRight?.size.width ?? 0)

  // Row heights: max of left and right in each row
  const row0Height = Math.max(topLeft.size.height, topRight?.size.height ?? 0)
  const row1Height = Math.max(bottomLeft?.size.height ?? 0, bottomRight?.size.height ?? 0)

  const totalWidth = col0Width + (col1Width > 0 ? TILE_GAP + col1Width : 0)
  const totalHeight = row0Height + (row1Height > 0 ? TILE_GAP + row1Height : 0)

  const startX = origin.x - totalWidth / 2
  const startY = origin.y - totalHeight / 2

  positions.set(topLeft.id, { x: startX, y: startY })

  if (topRight) {
    positions.set(topRight.id, { x: startX + col0Width + TILE_GAP, y: startY })
  }

  if (bottomLeft) {
    positions.set(bottomLeft.id, { x: startX, y: startY + row0Height + TILE_GAP })
  }

  if (bottomRight) {
    positions.set(bottomRight.id, {
      x: startX + col0Width + TILE_GAP,
      y: startY + row0Height + TILE_GAP
    })
  }

  return positions
}

function layoutMainSidebar(
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  if (cards.length === 1) {
    const c = cards[0]
    positions.set(c.id, {
      x: origin.x - c.size.width / 2,
      y: origin.y - c.size.height / 2
    })
    return positions
  }

  const main = cards[0]
  const sideTop = cards[1]
  const sideBottom = cards.length > 2 ? cards[2] : undefined

  // Main card occupies ~60% of total width, sidebar ~40%
  // Use actual card widths for positioning
  const sidebarWidth = Math.max(sideTop.size.width, sideBottom?.size.width ?? 0)
  const totalWidth = main.size.width + TILE_GAP + sidebarWidth

  // Main card height spans both sidebar cards
  const sidebarHeight = sideBottom
    ? sideTop.size.height + TILE_GAP + sideBottom.size.height
    : sideTop.size.height
  const totalHeight = Math.max(main.size.height, sidebarHeight)

  const startX = origin.x - totalWidth / 2
  const startY = origin.y - totalHeight / 2

  positions.set(main.id, { x: startX, y: startY })
  positions.set(sideTop.id, { x: startX + main.size.width + TILE_GAP, y: startY })

  if (sideBottom) {
    positions.set(sideBottom.id, {
      x: startX + main.size.width + TILE_GAP,
      y: startY + sideTop.size.height + TILE_GAP
    })
  }

  return positions
}

function layoutTriple(
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (cards.length === 0) return positions

  if (cards.length === 1) {
    const c = cards[0]
    positions.set(c.id, {
      x: origin.x - c.size.width / 2,
      y: origin.y - c.size.height / 2
    })
    return positions
  }

  const available = cards.slice(0, 3)
  let totalWidth = 0
  let maxHeight = 0

  for (let i = 0; i < available.length; i++) {
    if (i > 0) totalWidth += TILE_GAP
    totalWidth += available[i].size.width
    maxHeight = Math.max(maxHeight, available[i].size.height)
  }

  const startX = origin.x - totalWidth / 2
  const startY = origin.y - maxHeight / 2

  let cursorX = startX
  for (const card of available) {
    positions.set(card.id, { x: cursorX, y: startY })
    cursorX += card.size.width + TILE_GAP
  }

  return positions
}

// ---------------------------------------------------------------------------
// Overflow row — places extra cards in a row below the main pattern
// ---------------------------------------------------------------------------

function layoutOverflowRow(
  origin: { readonly x: number; readonly y: number },
  primaryPositions: Map<string, { x: number; y: number }>,
  primaryCards: readonly TileCard[],
  overflowCards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  if (overflowCards.length === 0) return new Map()

  // Find the bottom edge of the primary layout
  let maxBottom = -Infinity
  for (const card of primaryCards) {
    const pos = primaryPositions.get(card.id)
    if (pos) {
      const bottom = pos.y + card.size.height
      if (bottom > maxBottom) maxBottom = bottom
    }
  }

  // Place overflow cards in a row, centered on origin.x, below the primary layout
  let totalWidth = 0
  for (let i = 0; i < overflowCards.length; i++) {
    if (i > 0) totalWidth += TILE_GAP
    totalWidth += overflowCards[i].size.width
  }

  const startX = origin.x - totalWidth / 2
  const startY = maxBottom + TILE_GAP

  const positions = new Map<string, { x: number; y: number }>()
  let cursorX = startX
  for (const card of overflowCards) {
    positions.set(card.id, { x: cursorX, y: startY })
    cursorX += card.size.width + TILE_GAP
  }

  return positions
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Semantic layout — topic-based clustering using vault graph data
// ---------------------------------------------------------------------------

const CLUSTER_GAP = 120
const INTRA_GAP = 24

export interface ClusterLabel {
  readonly label: string
  readonly position: { readonly x: number; readonly y: number }
}

interface SemanticLayoutResult {
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
  readonly labels: readonly ClusterLabel[]
}

interface SemanticCard extends TileCard {
  readonly filePath?: string
}

interface ArtifactInfo {
  readonly id: string
  readonly tags: readonly string[]
}

interface GraphEdge {
  readonly source: string
  readonly target: string
}

/**
 * Arrange canvas cards into tag-based clusters with graph-aware ordering.
 * Cards are grouped by their primary (top-level) tag, clusters are arranged
 * in a grid, and within each cluster cards with the most intra-cluster edges
 * sit toward the center.
 */
export function computeSemanticLayout(
  origin: { readonly x: number; readonly y: number },
  cards: readonly SemanticCard[],
  fileToId: ReadonlyMap<string, string>,
  artifacts: ReadonlyMap<string, ArtifactInfo>,
  edges: readonly GraphEdge[]
): SemanticLayoutResult {
  if (cards.length === 0) return { positions: new Map(), labels: [] }

  // 1. Assign each card to a cluster by primary top-level tag
  const clusterMap = new Map<string, SemanticCard[]>()

  for (const card of cards) {
    const fp = card.filePath ?? card.id
    const artId = fileToId.get(fp)
    const art = artId ? artifacts.get(artId) : undefined
    const primaryTag = art?.tags?.[0]
    const clusterKey = primaryTag ? primaryTag.split('/')[0] : 'Untagged'

    const bucket = clusterMap.get(clusterKey)
    if (bucket) {
      bucket.push(card)
    } else {
      clusterMap.set(clusterKey, [card])
    }
  }

  // 2. Sort clusters alphabetically, with "Untagged" last
  const clusterKeys = [...clusterMap.keys()].sort((a, b) => {
    if (a === 'Untagged') return 1
    if (b === 'Untagged') return -1
    return a.localeCompare(b)
  })

  // 3. For each cluster, sort cards by intra-cluster edge count (descending)
  const sortedClusters = clusterKeys.map((key) => {
    const clusterCards = clusterMap.get(key)!
    const clusterArtIds = new Set<string>()
    const cardToArtId = new Map<string, string>()

    for (const card of clusterCards) {
      const fp = card.filePath ?? card.id
      const artId = fileToId.get(fp)
      if (artId) {
        clusterArtIds.add(artId)
        cardToArtId.set(card.id, artId)
      }
    }

    // Count intra-cluster edges per card
    const edgeCounts = new Map<string, number>()
    for (const card of clusterCards) {
      const artId = cardToArtId.get(card.id)
      if (!artId) continue
      let count = 0
      for (const edge of edges) {
        if (edge.source === artId && clusterArtIds.has(edge.target)) count++
        if (edge.target === artId && clusterArtIds.has(edge.source)) count++
      }
      edgeCounts.set(card.id, count)
    }

    // Sort: most connected first (center of cluster)
    const sorted = [...clusterCards].sort(
      (a, b) => (edgeCounts.get(b.id) ?? 0) - (edgeCounts.get(a.id) ?? 0)
    )

    return { key, cards: sorted }
  })

  // 4. Compute each cluster's local sub-grid layout
  const clusterLayouts: {
    key: string
    positions: Map<string, { x: number; y: number }>
    width: number
    height: number
  }[] = []

  for (const { key, cards: clusterCards } of sortedClusters) {
    const cols = clusterCards.length <= 2 ? 1 : clusterCards.length <= 6 ? 2 : 3
    const rows = Math.ceil(clusterCards.length / cols)

    // Compute column widths and row heights from actual card sizes
    const colWidths: number[] = Array(cols).fill(0)
    const rowHeights: number[] = Array(rows).fill(0)

    for (let i = 0; i < clusterCards.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      colWidths[col] = Math.max(colWidths[col], clusterCards[i].size.width)
      rowHeights[row] = Math.max(rowHeights[row], clusterCards[i].size.height)
    }

    const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (cols - 1) * INTRA_GAP
    const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (rows - 1) * INTRA_GAP

    // Position cards within local coords (0,0 is top-left of cluster)
    const positions = new Map<string, { x: number; y: number }>()
    for (let i = 0; i < clusterCards.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)

      let x = 0
      for (let c = 0; c < col; c++) x += colWidths[c] + INTRA_GAP
      let y = 0
      for (let r = 0; r < row; r++) y += rowHeights[r] + INTRA_GAP

      positions.set(clusterCards[i].id, { x, y })
    }

    clusterLayouts.push({ key, positions, width: totalWidth, height: totalHeight })
  }

  // 5. Arrange clusters in a meta-grid, centered on origin
  const metaCols = Math.ceil(Math.sqrt(clusterLayouts.length))
  const metaRows = Math.ceil(clusterLayouts.length / metaCols)

  // Compute meta-grid column widths and row heights
  const metaColWidths: number[] = Array(metaCols).fill(0)
  const metaRowHeights: number[] = Array(metaRows).fill(0)
  // Add label height offset (20px above each cluster)
  const LABEL_HEIGHT = 20

  for (let i = 0; i < clusterLayouts.length; i++) {
    const col = i % metaCols
    const row = Math.floor(i / metaCols)
    metaColWidths[col] = Math.max(metaColWidths[col], clusterLayouts[i].width)
    metaRowHeights[row] = Math.max(metaRowHeights[row], clusterLayouts[i].height + LABEL_HEIGHT)
  }

  const metaTotalWidth = metaColWidths.reduce((sum, w) => sum + w, 0) + (metaCols - 1) * CLUSTER_GAP
  const metaTotalHeight =
    metaRowHeights.reduce((sum, h) => sum + h, 0) + (metaRows - 1) * CLUSTER_GAP

  const metaStartX = origin.x - metaTotalWidth / 2
  const metaStartY = origin.y - metaTotalHeight / 2

  // 6. Compute final positions and labels
  const allPositions = new Map<string, { x: number; y: number }>()
  const labels: ClusterLabel[] = []

  for (let i = 0; i < clusterLayouts.length; i++) {
    const col = i % metaCols
    const row = Math.floor(i / metaCols)
    const layout = clusterLayouts[i]

    let clusterX = metaStartX
    for (let c = 0; c < col; c++) clusterX += metaColWidths[c] + CLUSTER_GAP
    let clusterY = metaStartY
    for (let r = 0; r < row; r++) clusterY += metaRowHeights[r] + CLUSTER_GAP

    // Label sits above the cluster
    labels.push({
      label: layout.key,
      position: { x: clusterX, y: clusterY }
    })

    // Cards start below the label
    const cardsStartY = clusterY + LABEL_HEIGHT

    for (const [cardId, localPos] of layout.positions) {
      allPositions.set(cardId, {
        x: clusterX + localPos.x,
        y: cardsStartY + localPos.y
      })
    }
  }

  return { positions: allPositions, labels }
}

// ---------------------------------------------------------------------------
// Geometric tile layout — existing system
// ---------------------------------------------------------------------------

export function computeTileLayout(
  pattern: TilePattern,
  origin: { readonly x: number; readonly y: number },
  cards: readonly TileCard[]
): Map<string, { x: number; y: number }> {
  if (cards.length === 0) return new Map()

  const slots = slotCount(pattern)
  const primaryCards = cards.slice(0, slots)
  const overflowCards = cards.slice(slots)

  let primaryPositions: Map<string, { x: number; y: number }>

  switch (pattern) {
    case 'split-h':
      primaryPositions = layoutSplitH(origin, primaryCards)
      break
    case 'split-v':
      primaryPositions = layoutSplitV(origin, primaryCards)
      break
    case 'grid-2x2':
      primaryPositions = layoutGrid2x2(origin, primaryCards)
      break
    case 'main-sidebar':
      primaryPositions = layoutMainSidebar(origin, primaryCards)
      break
    case 'triple':
      primaryPositions = layoutTriple(origin, primaryCards)
      break
  }

  if (overflowCards.length === 0) return primaryPositions

  const overflowPositions = layoutOverflowRow(origin, primaryPositions, primaryCards, overflowCards)

  // Merge primary and overflow into a new map (immutable)
  const result = new Map(primaryPositions)
  for (const [id, pos] of overflowPositions) {
    result.set(id, pos)
  }
  return result
}
