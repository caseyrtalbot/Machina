/**
 * Compute line-count delta between previous and current file content.
 * Returns a display string like "+12" or "-5" or "+12/-5" for mixed changes.
 * Used by FileViewCard's modified badge.
 */
export function computeLineDelta(
  previousLineCount: number,
  currentContent: string
): { added: number; removed: number; display: string } {
  const currentLineCount = currentContent.split('\n').length
  const diff = currentLineCount - previousLineCount

  if (diff > 0) {
    return { added: diff, removed: 0, display: `+${diff}` }
  } else if (diff < 0) {
    return { added: 0, removed: Math.abs(diff), display: `${diff}` }
  }
  // Line count same but content may differ
  return { added: 0, removed: 0, display: 'modified' }
}

/**
 * Count lines in a string. Empty string has 0 lines (not 1).
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0
  return content.split('\n').length
}
