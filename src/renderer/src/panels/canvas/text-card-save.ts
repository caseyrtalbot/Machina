const TIMESTAMP_PREFIX = 'canvas-note'
const MAX_SLUG_LEN = 60
const MAX_COLLISION_ATTEMPTS = 999

const MARKDOWN_LINE_PREFIX = /^(\s*[#>-]+\s*(\[[ xX]\]\s*)?|\s*\d+\.\s+|\s*\*\s+)/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function timestampSlug(now: Date): string {
  const y = now.getUTCFullYear()
  const mo = pad2(now.getUTCMonth() + 1)
  const d = pad2(now.getUTCDate())
  const h = pad2(now.getUTCHours())
  const mi = pad2(now.getUTCMinutes())
  return `${TIMESTAMP_PREFIX}-${y}-${mo}-${d}-${h}${mi}`
}

function firstNonEmptyLine(text: string): string {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.trim().length > 0) return line
  }
  return ''
}

export function slugifyFilename(firstLine: string, now: Date): string {
  const line = firstNonEmptyLine(firstLine)
  if (!line) return timestampSlug(now)

  const stripped = line.replace(MARKDOWN_LINE_PREFIX, '').trim()
  if (!stripped) return timestampSlug(now)

  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)

  return slug || timestampSlug(now)
}

export function resolveNewPath(dir: string, slug: string, existing: string[]): string {
  const taken = new Set(existing)
  const base = `${slug}.md`
  if (!taken.has(base)) return `${dir}/${base}`

  for (let i = 2; i <= MAX_COLLISION_ATTEMPTS + 1; i += 1) {
    const candidate = `${slug} (${i}).md`
    if (!taken.has(candidate)) return `${dir}/${candidate}`
  }

  throw new Error(
    `could not allocate filename for slug "${slug}" after ${MAX_COLLISION_ATTEMPTS} attempts`
  )
}

export function appendToExisting(existing: string, addition: string): string {
  if (existing.trim().length === 0) return addition
  const trimmedTrailing = existing.replace(/\n+$/, '')
  return `${trimmedTrailing}\n\n${addition}`
}

// djb2 — small sync hash sufficient for "did this change?" comparison
export function hashContent(content: string): string {
  let h = 5381
  for (let i = 0; i < content.length; i += 1) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}
