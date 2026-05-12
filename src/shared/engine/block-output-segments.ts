import type { SecretRef } from './block-model'

interface OutputSegment {
  readonly text: string
  readonly secret: SecretRef | null
}

/**
 * Split a block's output text into segments delineated by secret offsets.
 * Returns alternating safe / secret segments in order. Secrets that overlap
 * or extend past the text are clamped; out-of-order secrets are sorted.
 */
export function segmentOutput(text: string, secrets: readonly SecretRef[]): OutputSegment[] {
  if (secrets.length === 0) {
    return text.length > 0 ? [{ text, secret: null }] : []
  }
  const sorted = [...secrets].sort((a, b) => a.start - b.start)
  const out: OutputSegment[] = []
  let cursor = 0
  for (const s of sorted) {
    const start = Math.max(cursor, Math.min(s.start, text.length))
    const end = Math.max(start, Math.min(s.end, text.length))
    if (end <= start) continue
    if (start > cursor) {
      out.push({ text: text.slice(cursor, start), secret: null })
    }
    out.push({ text: text.slice(start, end), secret: s })
    cursor = end
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), secret: null })
  }
  return out
}

const MASK_CHAR = '•'

export function maskSegmentText(text: string): string {
  return MASK_CHAR.repeat([...text].length)
}
