import type { CanvasNode } from '@shared/canvas-types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Nodes whose center-y positions differ by no more than this value (in px)
 * are bucketed into the same row for left-to-right sorting.
 * Half the default card height (~160 / 2 = 80).
 */
export const ROW_BUCKET_THRESHOLD = 80

// ---------------------------------------------------------------------------
// spatialSort
// ---------------------------------------------------------------------------

interface NodeCenter {
  readonly id: string
  readonly cx: number
  readonly cy: number
}

/**
 * Sort canvas nodes by spatial position: left-to-right within rows,
 * top-to-bottom between rows. Returns an array of node IDs in sorted order.
 *
 * Row bucketing: nodes whose center-y values are within ROW_BUCKET_THRESHOLD
 * of each other are considered part of the same row and sorted by center-x.
 * Ties on both axes are broken by ID for stable ordering.
 */
export function spatialSort(nodes: readonly CanvasNode[]): readonly string[] {
  if (nodes.length === 0) return []

  const centers: readonly NodeCenter[] = nodes.map((n) => ({
    id: n.id,
    cx: n.position.x + n.size.width / 2,
    cy: n.position.y + n.size.height / 2
  }))

  // Sort by center-y first, then by center-x, then by ID for stability
  const sorted = [...centers].sort((a, b) => {
    if (a.cy !== b.cy) return a.cy - b.cy
    if (a.cx !== b.cx) return a.cx - b.cx
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Group into rows: start a new row when center-y exceeds the row's
  // representative center-y by more than ROW_BUCKET_THRESHOLD
  const rows: NodeCenter[][] = []
  let currentRow: NodeCenter[] = [sorted[0]]
  let rowCenterY = sorted[0].cy

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cy - rowCenterY > ROW_BUCKET_THRESHOLD) {
      rows.push(currentRow)
      currentRow = [sorted[i]]
      rowCenterY = sorted[i].cy
    } else {
      currentRow.push(sorted[i])
    }
  }
  rows.push(currentRow)

  // Within each row, sort by center-x (then by ID for ties)
  const result: string[] = []
  for (const row of rows) {
    const sortedRow = [...row].sort((a, b) => {
      if (a.cx !== b.cx) return a.cx - b.cx
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    for (const node of sortedRow) {
      result.push(node.id)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// nextCard / prevCard
// ---------------------------------------------------------------------------

/**
 * Returns the next card ID in the sorted list, wrapping from last to first.
 * If currentId is null or not found, returns the first ID.
 * Returns null if sortedIds is empty.
 */
export function nextCard(sortedIds: readonly string[], currentId: string | null): string | null {
  if (sortedIds.length === 0) return null

  if (currentId === null) return sortedIds[0]

  const index = sortedIds.indexOf(currentId)
  if (index === -1) return sortedIds[0]

  return sortedIds[(index + 1) % sortedIds.length]
}

/**
 * Returns the previous card ID in the sorted list, wrapping from first to last.
 * If currentId is null or not found, returns the last ID.
 * Returns null if sortedIds is empty.
 */
export function prevCard(sortedIds: readonly string[], currentId: string | null): string | null {
  if (sortedIds.length === 0) return null

  if (currentId === null) return sortedIds[sortedIds.length - 1]

  const index = sortedIds.indexOf(currentId)
  if (index === -1) return sortedIds[sortedIds.length - 1]

  return sortedIds[(index - 1 + sortedIds.length) % sortedIds.length]
}
