// src/shared/engine/project-map-types.ts

import type { CanvasNodeType } from '../canvas-types'

/** Edge kinds specific to the project-map domain.
 *  At the canvas level these flow through the (string & {}) escape hatch
 *  on CanvasEdge.kind — no modification to CanvasEdgeKind union needed.
 */
export type ProjectMapEdgeKind = 'contains' | 'imports' | 'references'

export interface ProjectMapNode {
  readonly id: string
  readonly relativePath: string
  readonly name: string
  readonly isDirectory: boolean
  readonly nodeType: CanvasNodeType
  readonly depth: number
  readonly lineCount: number
  readonly children: readonly string[]
  readonly childCount: number
  readonly error?: string
}

export interface ProjectMapEdge {
  readonly source: string
  readonly target: string
  readonly kind: ProjectMapEdgeKind
}

export interface ProjectMapSnapshot {
  readonly rootPath: string
  readonly nodes: readonly ProjectMapNode[]
  readonly edges: readonly ProjectMapEdge[]
  readonly truncated: boolean
  readonly totalFileCount: number
  readonly skippedCount: number
  readonly unresolvedRefs: readonly string[]
}

export interface ProjectMapOptions {
  readonly expandDepth: number
  readonly maxNodes: number
}

export const DEFAULT_PROJECT_MAP_OPTIONS: ProjectMapOptions = {
  expandDepth: 2,
  maxNodes: 200
} as const

/** Extensions that are treated as binary (skipped, not analyzed). */
export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.so',
  '.dylib',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.sqlite',
  '.db'
])

/** Check if a file path has a binary extension. */
export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return false
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/**
 * Generate a stable, deterministic node ID from root path + relative path.
 * Same input always produces same ID.
 */
export function stableNodeId(rootPath: string, relativePath: string): string {
  const key = `${rootPath}::${relativePath}`
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return `pm_${(hash >>> 0).toString(36)}`
}
