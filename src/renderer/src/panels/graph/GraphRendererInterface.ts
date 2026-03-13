import type { SimNode, SimEdge, NodeSizeConfig } from './GraphRenderer'
import { renderGraph, findNodeAt } from './GraphRenderer'
import type { HighlightState } from './useGraphHighlight'

export interface RenderParams {
  ctx: CanvasRenderingContext2D
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  width: number
  height: number
  selectedId: string | null
  hoveredId: string | null
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
}

export interface GraphRendererInterface {
  render(params: RenderParams): number
  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null
  resize(width: number, height: number, dpr: number): void
  dispose(): void
}

export class Canvas2DGraphRenderer implements GraphRendererInterface {
  private width = 0
  private height = 0
  private dpr = 1

  render(params: RenderParams): number {
    return renderGraph(
      params.ctx,
      params.nodes,
      params.edges,
      params.width,
      params.height,
      params.selectedId,
      params.hoveredId,
      {
        highlight: params.highlight,
        sizeConfig: params.sizeConfig,
        transform: params.transform,
        canvasWidth: params.canvasWidth,
        canvasHeight: params.canvasHeight,
        reducedMotion: params.reducedMotion,
      }
    )
  }

  hitTest(nodes: readonly SimNode[], x: number, y: number): SimNode | null {
    return findNodeAt(nodes as SimNode[], x, y)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
  }

  dispose(): void {
    // Canvas2D has no GPU resources to release
    // GlowSpriteCache is module-scoped in GraphRenderer
  }
}
