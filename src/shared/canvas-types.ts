export type CanvasNodeType = 'text' | 'note' | 'terminal'
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

export interface CanvasNode {
  readonly id: string
  readonly type: CanvasNodeType
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  readonly content: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface CanvasEdge {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide: CanvasSide
  readonly toSide: CanvasSide
}

export interface CanvasViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface CanvasFile {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly viewport: CanvasViewport
}

// --- Min sizes per node type ---

const MIN_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 200, height: 100 },
  note: { width: 200, height: 100 },
  terminal: { width: 300, height: 200 }
}

const DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 260, height: 140 },
  note: { width: 280, height: 200 },
  terminal: { width: 400, height: 280 }
}

export function getMinSize(type: CanvasNodeType): { width: number; height: number } {
  return MIN_SIZES[type]
}

// --- Factory helpers ---

let counter = 0
function uid(): string {
  return `cn_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

export function createCanvasNode(
  type: CanvasNodeType,
  position: { x: number; y: number },
  overrides?: Partial<Pick<CanvasNode, 'size' | 'content' | 'metadata'>>
): CanvasNode {
  return {
    id: uid(),
    type,
    position: { x: position.x, y: position.y },
    size: overrides?.size ?? { ...DEFAULT_SIZES[type] },
    content: overrides?.content ?? '',
    metadata: overrides?.metadata ?? {}
  }
}

export function createCanvasEdge(
  fromNode: string,
  toNode: string,
  fromSide: CanvasSide,
  toSide: CanvasSide
): CanvasEdge {
  return { id: uid(), fromNode, toNode, fromSide, toSide }
}

export function createCanvasFile(): CanvasFile {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}
