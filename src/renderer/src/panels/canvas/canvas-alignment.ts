/**
 * Drag-time alignment: snap a moving card to neighboring card edges/centers
 * and describe the guide lines to render while snapped.
 *
 * The math is pure (unit-tested in tests/canvas/canvas-spatial-parity.test.ts);
 * AlignmentGuideOverlay is the thin DOM renderer used by use-canvas-drag.
 */

/** Snap distance in screen pixels; callers divide by zoom for canvas units. */
export const ALIGN_SNAP_THRESHOLD_PX = 6

export interface AlignmentBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AlignmentGuide {
  /** Vertical guides align x positions; horizontal guides align y positions. */
  readonly axis: 'vertical' | 'horizontal'
  /** Canvas coordinate of the guide line (x for vertical, y for horizontal). */
  readonly position: number
  /** Extent of the line along the other axis. */
  readonly start: number
  readonly end: number
}

export interface AlignmentSnapResult {
  readonly x: number
  readonly y: number
  readonly guides: readonly AlignmentGuide[]
}

/** Edge and center stops for one axis of a box. */
function stops(start: number, span: number): readonly [number, number, number] {
  return [start, start + span / 2, start + span]
}

function bestDelta(
  movingStops: readonly number[],
  neighbors: readonly AlignmentBox[],
  axis: 'vertical' | 'horizontal',
  threshold: number
): number | null {
  let best: number | null = null
  for (const nb of neighbors) {
    const nbStops = axis === 'vertical' ? stops(nb.x, nb.width) : stops(nb.y, nb.height)
    for (const ns of nbStops) {
      for (const ms of movingStops) {
        const d = ns - ms
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) {
          best = d
        }
      }
    }
  }
  return best
}

const GUIDE_EPSILON = 0.01

function guidesForAxis(
  snapped: AlignmentBox,
  neighbors: readonly AlignmentBox[],
  axis: 'vertical' | 'horizontal'
): readonly AlignmentGuide[] {
  const movingStops =
    axis === 'vertical' ? stops(snapped.x, snapped.width) : stops(snapped.y, snapped.height)
  const movingExtent =
    axis === 'vertical'
      ? ([snapped.y, snapped.y + snapped.height] as const)
      : ([snapped.x, snapped.x + snapped.width] as const)

  // One guide per aligned coordinate, spanning every box that shares it.
  const byPosition = new Map<number, { start: number; end: number }>()
  for (const nb of neighbors) {
    const nbStops = axis === 'vertical' ? stops(nb.x, nb.width) : stops(nb.y, nb.height)
    const nbExtent =
      axis === 'vertical' ? ([nb.y, nb.y + nb.height] as const) : ([nb.x, nb.x + nb.width] as const)
    for (const ns of nbStops) {
      const match = movingStops.find((ms) => Math.abs(ms - ns) < GUIDE_EPSILON)
      if (match === undefined) continue
      const existing = byPosition.get(ns)
      byPosition.set(ns, {
        start: Math.min(existing?.start ?? movingExtent[0], nbExtent[0]),
        end: Math.max(existing?.end ?? movingExtent[1], nbExtent[1])
      })
    }
  }
  return [...byPosition.entries()].map(([position, span]) => ({
    axis,
    position,
    start: span.start,
    end: span.end
  }))
}

/**
 * Snap `moving` to the nearest neighbor edge/center within `threshold`
 * (canvas units), independently per axis. Guides are returned only when an
 * axis snapped; an empty array means free movement.
 */
export function computeAlignmentSnap(
  moving: AlignmentBox,
  neighbors: readonly AlignmentBox[],
  threshold: number
): AlignmentSnapResult {
  const dx = bestDelta(stops(moving.x, moving.width), neighbors, 'vertical', threshold)
  const dy = bestDelta(stops(moving.y, moving.height), neighbors, 'horizontal', threshold)
  const snapped: AlignmentBox = {
    x: moving.x + (dx ?? 0),
    y: moving.y + (dy ?? 0),
    width: moving.width,
    height: moving.height
  }
  const guides: AlignmentGuide[] = []
  if (dx !== null) guides.push(...guidesForAxis(snapped, neighbors, 'vertical'))
  if (dy !== null) guides.push(...guidesForAxis(snapped, neighbors, 'horizontal'))
  return { x: snapped.x, y: snapped.y, guides }
}

// ── DOM overlay ──────────────────────────────────────────────────────────────
// Guide lines live inside the canvas transform layer (the cards' parent), so
// they are positioned in canvas coordinates and pan/zoom with the content.
// They exist only for the duration of a drag.

export class AlignmentGuideOverlay {
  private readonly parent: HTMLElement
  private readonly zoom: number
  private els: HTMLDivElement[] = []

  constructor(parent: HTMLElement, zoom: number) {
    this.parent = parent
    this.zoom = zoom
  }

  update(guides: readonly AlignmentGuide[]): void {
    // Reconcile element count
    while (this.els.length > guides.length) {
      this.els.pop()?.remove()
    }
    while (this.els.length < guides.length) {
      const el = document.createElement('div')
      el.style.position = 'absolute'
      el.style.pointerEvents = 'none'
      el.style.background = 'var(--color-accent-default)'
      el.style.opacity = '0.85'
      this.parent.appendChild(el)
      this.els.push(el)
    }
    const hairline = `${1 / this.zoom}px`
    guides.forEach((g, i) => {
      const el = this.els[i]
      if (g.axis === 'vertical') {
        el.style.left = `${g.position}px`
        el.style.top = `${g.start}px`
        el.style.width = hairline
        el.style.height = `${g.end - g.start}px`
      } else {
        el.style.left = `${g.start}px`
        el.style.top = `${g.position}px`
        el.style.width = `${g.end - g.start}px`
        el.style.height = hairline
      }
    })
  }

  destroy(): void {
    for (const el of this.els) el.remove()
    this.els = []
  }
}
