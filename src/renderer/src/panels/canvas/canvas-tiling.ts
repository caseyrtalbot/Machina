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
