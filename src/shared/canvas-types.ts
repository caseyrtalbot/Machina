export type CanvasNodeType =
  | 'text'
  | 'note'
  | 'terminal'
  | 'code'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'project-file'
  | 'system-artifact'
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

// --- Per-type metadata (discriminated by node.type) ---

export interface CodeNodeMeta {
  readonly language: string
  readonly filename?: string
}

export interface ImageNodeMeta {
  readonly src: string
  readonly alt?: string
}

export interface MarkdownNodeMeta {
  readonly viewMode: 'rendered' | 'source'
}

export interface PdfNodeMeta {
  readonly src: string
  readonly pageCount: number
  readonly currentPage: number
}

export interface ProjectFileNodeMeta {
  readonly relativePath: string
  readonly language: string
  readonly touchCount: number
  readonly lastTouchedBy: string | null
}

export interface SystemArtifactNodeMeta {
  readonly artifactKind: 'session' | 'pattern' | 'tension'
  readonly artifactId: string
  readonly status: string
  readonly filePath: string
  readonly summary?: string
  readonly signal: string
  readonly fileRefCount: number
  readonly question?: string
  readonly hasSnapshot?: boolean
  readonly snapshotPath?: string
  readonly commandCount?: number
  readonly fileTouchCount?: number
  readonly connections: readonly string[]
  readonly tensionRefs: readonly string[]
}

export interface CanvasNode {
  readonly id: string
  readonly type: CanvasNodeType
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  readonly content: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export type CanvasEdgeKind = 'connection' | 'cluster' | 'tension'

export interface CanvasEdge {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide: CanvasSide
  readonly toSide: CanvasSide
  readonly kind?: CanvasEdgeKind | (string & {})
  readonly label?: string
  readonly hidden?: boolean
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
  readonly focusFrames?: Readonly<Record<string, CanvasViewport>>
}

// --- Min sizes per node type ---

const MIN_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 200, height: 100 },
  note: { width: 200, height: 100 },
  terminal: { width: 300, height: 200 },
  code: { width: 300, height: 200 },
  markdown: { width: 250, height: 150 },
  image: { width: 150, height: 150 },
  pdf: { width: 300, height: 400 },
  'project-file': { width: 200, height: 60 },
  'system-artifact': { width: 240, height: 120 }
}

const DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 260, height: 140 },
  note: { width: 450, height: 550 },
  terminal: { width: 400, height: 280 },
  code: { width: 480, height: 320 },
  markdown: { width: 400, height: 300 },
  image: { width: 300, height: 300 },
  pdf: { width: 500, height: 650 },
  'project-file': { width: 240, height: 80 },
  'system-artifact': { width: 300, height: 180 }
}

export function getMinSize(type: CanvasNodeType): { width: number; height: number } {
  return MIN_SIZES[type]
}

export function getDefaultSize(type: CanvasNodeType): { width: number; height: number } {
  return DEFAULT_SIZES[type]
}

// --- Card display metadata for menus and UI ---

export interface CardTypeInfo {
  readonly label: string
  readonly icon: string
  readonly category: 'content' | 'media' | 'tools'
}

export const CARD_TYPE_INFO: Record<CanvasNodeType, CardTypeInfo> = {
  text: { label: 'Text', icon: 'T', category: 'content' },
  code: { label: 'Code', icon: '</>', category: 'content' },
  markdown: { label: 'Markdown', icon: 'M', category: 'content' },
  note: { label: 'Vault Note', icon: 'N', category: 'content' },
  image: { label: 'Image', icon: 'I', category: 'media' },
  terminal: { label: 'Terminal', icon: '>', category: 'tools' },
  pdf: { label: 'PDF', icon: 'P', category: 'media' },
  'project-file': { label: 'File', icon: '\u25A0', category: 'tools' },
  'system-artifact': { label: 'Artifact', icon: '\u25C6', category: 'tools' }
}

// --- Default metadata per type ---

export function getDefaultMetadata(type: CanvasNodeType): Record<string, unknown> {
  switch (type) {
    case 'code':
      return { language: 'typescript' }
    case 'markdown':
      return { viewMode: 'rendered' }
    case 'image':
      return { src: '', alt: '' }
    case 'pdf':
      return { src: '', pageCount: 0, currentPage: 1 }
    case 'project-file':
      return { relativePath: '', language: '', touchCount: 0, lastTouchedBy: null }
    case 'system-artifact':
      return {
        artifactKind: 'session',
        artifactId: '',
        status: '',
        filePath: '',
        signal: 'untested',
        fileRefCount: 0,
        connections: [],
        tensionRefs: []
      }
    default:
      return {}
  }
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
    metadata: overrides?.metadata ?? getDefaultMetadata(type)
  }
}

export function createCanvasEdge(
  fromNode: string,
  toNode: string,
  fromSide: CanvasSide,
  toSide: CanvasSide,
  kind?: CanvasEdgeKind,
  label?: string
): CanvasEdge {
  return { id: uid(), fromNode, toNode, fromSide, toSide, kind, label }
}

export function createCanvasFile(): CanvasFile {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}
