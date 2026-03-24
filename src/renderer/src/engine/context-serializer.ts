import type { CanvasNode } from '@shared/canvas-types'

/** Escape text for use inside ANSI-C quoted shell arguments ($'...').
 *  This handles newlines, single quotes, and backslashes correctly
 *  so the entire command stays on one line when written to a PTY. */
export function escapeForShell(text: string): string {
  // Only safe inside $'...' ANSI-C quoting. Do not use in other shell contexts.
  return text
    .replace(/\\/g, '\\\\') // backslashes first
    .replace(/'/g, "\\'") // single quotes
    .replace(/\n/g, '\\n') // newlines
    .replace(/\r/g, '\\r') // carriage returns
    .replace(new RegExp(String.fromCharCode(0), 'g'), '\\x00') // null bytes
}

/** Extract the file path from a vault note card.
 *  Returns null if the card doesn't represent a vault file. */
function extractFilePath(node: CanvasNode): string | null {
  if (node.type !== 'note') return null
  const content = node.content
  // Vault note cards store a single-line file path as content.
  // The renderer reads the actual file to display it.
  if (!content.includes('\n') && (content.startsWith('/') || content.match(/^[A-Z]:\\/))) {
    return content
  }
  return null
}

/** Options for building canvas context. */
export interface CanvasContextOptions {
  /** Path where auto-notify writes updated context. Included in prompt
   *  so Claude knows where to read mid-session updates. */
  readonly contextFilePath?: string
}

/** Result from context building. */
export interface CanvasContextResult {
  /** The system prompt text to inject. */
  readonly text: string
  /** Number of file cards on the canvas (for badge). */
  readonly fileCount: number
}

/**
 * Build a canvas context prompt for Claude.
 *
 * Instead of serializing card content into the system prompt, this gives
 * Claude the file paths of vault notes on the canvas. Claude reads the
 * actual markdown files directly when relevant, getting full content,
 * frontmatter, and relationships rather than lossy snippets.
 */
export function buildCanvasContext(
  cardId: string,
  nodes: readonly CanvasNode[],
  options?: CanvasContextOptions
): CanvasContextResult {
  const self = nodes.find((n) => n.id === cardId)
  if (!self) return { text: '', fileCount: 0 }

  // Collect file paths from vault note cards on the canvas
  const filePaths: string[] = []
  for (const node of nodes) {
    if (node.id === cardId || node.type === 'terminal') continue
    const path = extractFilePath(node)
    if (path) filePaths.push(path)
  }

  const lines: string[] = [
    'You are running inside a canvas card (terminal) in Machina.',
    'The canvas is a spatial workspace where the user arranges files they are thinking about.'
  ]

  if (options?.contextFilePath) {
    lines.push(
      `Canvas context is kept up to date at: ${options.contextFilePath}`,
      'Read that file when you need the current list of canvas files.'
    )
  }

  if (filePaths.length > 0) {
    lines.push('')
    lines.push('The user has placed these files on the canvas:')
    for (const path of filePaths) {
      lines.push(`- ${path}`)
    }
    lines.push('')
    lines.push('Read these files directly when relevant to the conversation.')
  } else {
    lines.push('')
    lines.push('No files are on the canvas yet. The user may drop files onto the canvas later.')
  }

  return { text: lines.join('\n'), fileCount: filePaths.length }
}
