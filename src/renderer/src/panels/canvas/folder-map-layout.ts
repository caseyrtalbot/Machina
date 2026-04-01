/**
 * Reingold-Tilford tree layout for folder maps.
 * Pure functions -- imported by both the worker and tests.
 */

import type { CanvasNode, CanvasEdge, CanvasNodeType } from '@shared/canvas-types'
import { createCanvasNode, createCanvasEdge, getDefaultSize } from '@shared/canvas-types'
import type { ProjectMapNode, ProjectMapSnapshot } from '@shared/engine/project-map-types'
import { computeCardSize, computeOptimalEdgeSides } from './canvas-layout'
import { computeOriginOffset } from './import-logic'

export interface TreeLayoutOptions {
  readonly levelGap: number
  readonly siblingGap: number
  readonly clusterGap: number
}

export interface FolderMapLayoutResult {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

const DEFAULT_LAYOUT_OPTIONS: TreeLayoutOptions = {
  levelGap: 200,
  siblingGap: 40,
  clusterGap: 120
}

const FOLDER_SIZE = { width: 260, height: 80 }
const NOTE_BODY_CHARS_PER_LINE = 72

// --- Internal tree node for layout computation ---

interface LayoutNode {
  readonly pmId: string
  readonly name: string
  readonly isDirectory: boolean
  readonly nodeType: CanvasNodeType
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly metadata: Record<string, unknown>
  readonly children: readonly LayoutNode[]
  subtreeWidth: number
  x: number
  y: number
}

function getNodeSize(pm: Pick<ProjectMapNode, 'isDirectory' | 'nodeType' | 'lineCount' | 'name'>): {
  width: number
  height: number
} {
  const { isDirectory, nodeType, lineCount, name } = pm
  if (isDirectory) return FOLDER_SIZE
  if (nodeType === 'note') {
    return computeCardSize({
      titleLength: name.length,
      bodyLength: lineCount * NOTE_BODY_CHARS_PER_LINE,
      metadataCount: 0
    })
  }
  return getDefaultSize(nodeType)
}

// --- Build layout tree from snapshot ---

function buildLayoutTree(snapshot: ProjectMapSnapshot): LayoutNode | null {
  const nodeMap = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const childIds = new Set(snapshot.edges.filter((e) => e.kind === 'contains').map((e) => e.target))

  // Root is the node that is never a child
  const rootPm = snapshot.nodes.find((n) => !childIds.has(n.id) && n.isDirectory)
  if (!rootPm) {
    return snapshot.nodes.length > 0 ? leafNode(snapshot.nodes[0], snapshot.rootPath) : null
  }

  function buildNode(pmId: string): LayoutNode | null {
    const pm = nodeMap.get(pmId)
    if (!pm) return null

    const size = getNodeSize(pm)
    const children: LayoutNode[] = []

    if (pm.isDirectory) {
      const childEdges = snapshot.edges.filter((e) => e.kind === 'contains' && e.source === pmId)
      for (const edge of childEdges) {
        const child = buildNode(edge.target)
        if (child) children.push(child)
      }
      // Sort: directories first, then alphabetical
      children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }

    const metadata: Record<string, unknown> = pm.isDirectory
      ? {
          relativePath: pm.relativePath,
          rootPath: snapshot.rootPath,
          childCount: pm.childCount,
          collapsed: false
        }
      : { relativePath: pm.relativePath, folderMapRoot: snapshot.rootPath }

    return {
      pmId,
      name: pm.name,
      isDirectory: pm.isDirectory,
      nodeType: pm.nodeType,
      width: size.width,
      height: size.height,
      depth: pm.depth,
      metadata,
      children,
      subtreeWidth: 0,
      x: 0,
      y: 0
    }
  }

  return buildNode(rootPm.id)
}

function leafNode(
  pm: {
    id: string
    name: string
    isDirectory: boolean
    nodeType: CanvasNodeType
    relativePath: string
    depth: number
    lineCount: number
  },
  rootPath: string
): LayoutNode {
  const size = getNodeSize(pm)
  return {
    pmId: pm.id,
    name: pm.name,
    isDirectory: pm.isDirectory,
    nodeType: pm.nodeType,
    width: size.width,
    height: size.height,
    depth: pm.depth,
    metadata: { relativePath: pm.relativePath, rootPath },
    children: [],
    subtreeWidth: 0,
    x: 0,
    y: 0
  }
}

// --- Reingold-Tilford layout passes ---

function computeSubtreeWidths(node: LayoutNode, opts: TreeLayoutOptions): void {
  if (node.children.length === 0) {
    node.subtreeWidth = node.width
    return
  }
  for (const child of node.children) {
    computeSubtreeWidths(child, opts)
  }
  const gap = node.children[0]?.isDirectory ? opts.clusterGap : opts.siblingGap
  const childrenWidth =
    node.children.reduce((sum, c) => sum + c.subtreeWidth, 0) + (node.children.length - 1) * gap
  node.subtreeWidth = Math.max(node.width, childrenWidth)
}

function assignPositions(node: LayoutNode, x: number, y: number, opts: TreeLayoutOptions): void {
  // Center this node over its subtree
  node.x = x + (node.subtreeWidth - node.width) / 2
  node.y = y

  if (node.children.length === 0) return

  const gap = node.children[0]?.isDirectory ? opts.clusterGap : opts.siblingGap
  let childX = x
  for (const child of node.children) {
    assignPositions(child, childX, y + node.height + opts.levelGap, opts)
    childX += child.subtreeWidth + gap
  }
}

// --- Collect positioned nodes into CanvasNode[] ---

function collectCanvasNodes(node: LayoutNode, rootPath: string): CanvasNode[] {
  const result: CanvasNode[] = []

  function walk(n: LayoutNode): void {
    const nodeType: CanvasNodeType = n.isDirectory ? 'project-folder' : n.nodeType
    const canvasNode = createCanvasNode(
      nodeType,
      { x: n.x, y: n.y },
      {
        size: { width: n.width, height: n.height },
        content: n.isDirectory ? '' : `${rootPath}/${n.metadata.relativePath}`,
        metadata: n.metadata
      }
    )
    // Override the random ID with the deterministic project-map ID
    const withStableId: CanvasNode = { ...canvasNode, id: n.pmId }
    result.push(withStableId)

    for (const child of n.children) {
      walk(child)
    }
  }

  walk(node)
  return result
}

// --- Build canvas edges ---

function buildCanvasEdges(
  snapshot: ProjectMapSnapshot,
  canvasNodes: readonly CanvasNode[]
): CanvasEdge[] {
  const nodeMap = new Map(canvasNodes.map((n) => [n.id, n]))
  const edges: CanvasEdge[] = []

  for (const pmEdge of snapshot.edges) {
    const from = nodeMap.get(pmEdge.source)
    const to = nodeMap.get(pmEdge.target)
    if (!from || !to) continue

    const { fromSide, toSide } = computeOptimalEdgeSides(from, to)
    const edge = createCanvasEdge(
      from.id,
      to.id,
      fromSide,
      toSide,
      undefined // kind goes through the string escape hatch on CanvasEdge
    )

    // Attach the project-map edge kind via the string escape hatch
    const withKind: CanvasEdge = { ...edge, kind: pmEdge.kind }

    // imports and references edges are hidden by default
    if (pmEdge.kind === 'imports' || pmEdge.kind === 'references') {
      edges.push({ ...withKind, hidden: true })
    } else {
      edges.push(withKind)
    }
  }

  return edges
}

// --- Public API ---

export function computeFolderMapLayout(
  snapshot: ProjectMapSnapshot,
  origin: { x: number; y: number },
  existingNodes: readonly CanvasNode[],
  options?: Partial<TreeLayoutOptions>
): FolderMapLayoutResult {
  if (snapshot.nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options }

  const tree = buildLayoutTree(snapshot)
  if (!tree) return { nodes: [], edges: [] }

  // 1. Bottom-up: compute subtree widths
  computeSubtreeWidths(tree, opts)

  // 2. Top-down: assign positions starting at origin
  assignPositions(tree, origin.x, origin.y, opts)

  // 3. Collect into canvas nodes
  const canvasNodes = collectCanvasNodes(tree, snapshot.rootPath)

  // 4. Collision resolution: shift right if overlapping existing nodes
  if (existingNodes.length > 0) {
    const offset = computeOriginOffset(existingNodes)
    if (offset > origin.x) {
      const shift = offset - origin.x
      const shifted = canvasNodes.map((node) => ({
        ...node,
        position: { ...node.position, x: node.position.x + shift }
      }))
      // Replace in-place (array is local, not shared)
      canvasNodes.length = 0
      canvasNodes.push(...shifted)
    }
  }

  // 5. Build edges
  const canvasEdges = buildCanvasEdges(snapshot, canvasNodes)

  return { nodes: canvasNodes, edges: canvasEdges }
}
