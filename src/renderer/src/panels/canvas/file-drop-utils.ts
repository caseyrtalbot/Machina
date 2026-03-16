import type { CanvasNodeType } from '@shared/canvas-types'

/** MIME type used for intra-app file drag data */
export const TE_FILE_MIME = 'application/x-te-file'

export interface DragFileData {
  readonly path: string
  readonly type: CanvasNodeType
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
  '.json', '.html', '.css', '.scss', '.yaml', '.yml',
  '.toml', '.sh', '.bash', '.zsh', '.lua', '.rb',
  '.java', '.kt', '.swift', '.c', '.cpp', '.h'
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'
])

/** Infer canvas card type from file extension */
export function inferCardType(path: string): CanvasNodeType {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (ext === '.md') return 'note'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'text'
}

/** Infer CodeMirror language name from file extension */
export function inferLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.js':
    case '.jsx':
      return 'javascript'
    case '.py':
      return 'python'
    case '.json':
      return 'json'
    case '.html':
    case '.htm':
      return 'html'
    case '.css':
    case '.scss':
      return 'css'
    default:
      return 'plaintext'
  }
}
