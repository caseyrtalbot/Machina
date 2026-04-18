import type { Result } from './types'
import type { SectionMap, ClusterSection } from '../cluster-types'

// A "section span" starts at its `## <heading>` line and ends immediately
// before the next `##`-or-higher heading (or at EOF).
// Same-level = `##`. Higher-level = `#`. Lower-level (`###`+) stays inside.

const H2_RE = /^##\s+(.+?)\s*$/

interface HeadingHit {
  readonly lineIndex: number
  readonly heading: string
  readonly level: 1 | 2
}

function findHeadings(lines: readonly string[]): readonly HeadingHit[] {
  const hits: HeadingHit[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      const m = H2_RE.exec(line)
      if (m) hits.push({ lineIndex: i, heading: m[1], level: 2 })
    } else if (line.startsWith('# ')) {
      hits.push({ lineIndex: i, heading: line.slice(2).trim(), level: 1 })
    }
  }
  return hits
}

function findSectionSpan(
  lines: readonly string[],
  heading: string
): { readonly start: number; readonly end: number } | null {
  const hits = findHeadings(lines)
  const idx = hits.findIndex((h) => h.level === 2 && h.heading === heading)
  if (idx === -1) return null

  const start = hits[idx].lineIndex
  let end = lines.length
  for (let j = idx + 1; j < hits.length; j++) {
    if (hits[j].level <= 2) {
      end = hits[j].lineIndex
      break
    }
  }
  return { start, end }
}

export function extractSection(
  fileContent: string,
  sectionId: string,
  sectionMap: SectionMap
): Result<string> {
  const heading = sectionMap[sectionId]
  if (!heading) return { ok: false, error: 'section-not-found' }

  const lines = fileContent.split('\n')
  const span = findSectionSpan(lines, heading)
  if (!span) return { ok: false, error: 'section-not-found' }

  const bodyLines = lines.slice(span.start + 1, span.end)
  return { ok: true, value: bodyLines.join('\n') }
}

export function replaceSection(
  fileContent: string,
  sectionId: string,
  newBody: string,
  sectionMap: SectionMap
): Result<string> {
  const heading = sectionMap[sectionId]
  if (!heading) return { ok: false, error: 'section-not-found' }

  const lines = fileContent.split('\n')
  const span = findSectionSpan(lines, heading)
  if (!span) return { ok: false, error: 'section-not-found' }

  const headingLine = lines[span.start]
  const before = lines.slice(0, span.start)
  const after = lines.slice(span.end)
  // newBody is treated as the joined lines of the span body (matches what
  // extractSection returns), so we round-trip via split without trimming.
  const bodyLines = newBody.split('\n')

  const next = [...before, headingLine, ...bodyLines, ...after].join('\n')
  return { ok: true, value: next }
}

export function addSection(
  fileContent: string,
  section: ClusterSection,
  position: 'end',
  sectionMap: SectionMap
): Result<{ readonly content: string; readonly sectionMap: SectionMap }> {
  // `position` is currently fixed to 'end'. The parameter is retained so
  // callers remain explicit at the call site; positional insertion can be
  // added back later with proper bounds checks when a caller needs it.
  void position

  const existingHeadings = new Set(Object.values(sectionMap))
  let finalHeading = section.heading
  let n = 2
  while (existingHeadings.has(finalHeading)) {
    finalHeading = `${section.heading} (${n})`
    n++
  }

  const bodyWithNl = section.body.endsWith('\n') ? section.body : `${section.body}\n`
  const block = `\n## ${finalHeading}\n${bodyWithNl}`

  const lines = fileContent.split('\n')
  const insertIdx = lines.length

  const before = lines.slice(0, insertIdx).join('\n')
  const after = lines.slice(insertIdx).join('\n')
  const content = after ? `${before}${block}${after}` : `${before}${block}`

  return {
    ok: true,
    value: {
      content,
      sectionMap: { ...sectionMap, [section.cardId]: finalHeading }
    }
  }
}

export function removeSection(
  fileContent: string,
  sectionId: string,
  sectionMap: SectionMap
): Result<{ readonly content: string; readonly sectionMap: SectionMap }> {
  const heading = sectionMap[sectionId]
  if (!heading) return { ok: false, error: 'section-not-found' }

  const lines = fileContent.split('\n')
  const span = findSectionSpan(lines, heading)
  if (!span) return { ok: false, error: 'section-not-found' }

  const before = [...lines.slice(0, span.start)]
  const after = [...lines.slice(span.end)]
  // Avoid double-blank gap: collapse one leading blank of after if before also ends blank.
  while (
    after.length > 0 &&
    after[0] === '' &&
    before.length > 0 &&
    before[before.length - 1] === ''
  ) {
    after.shift()
  }
  const content = [...before, ...after].join('\n')

  const { [sectionId]: _removed, ...rest } = sectionMap
  return { ok: true, value: { content, sectionMap: rest } }
}

export function reorderSections(
  fileContent: string,
  order: readonly string[],
  sectionMap: SectionMap
): Result<string> {
  const lines = fileContent.split('\n')
  const firstH2 = findHeadings(lines).find((h) => h.level === 2)
  if (!firstH2) return { ok: false, error: 'no-sections-to-reorder' }

  const prelude = lines.slice(0, firstH2.lineIndex).join('\n')

  const spans = new Map<string, string>()
  for (const id of order) {
    const heading = sectionMap[id]
    if (!heading) return { ok: false, error: `section-not-found:${id}` }
    const span = findSectionSpan(lines, heading)
    if (!span) return { ok: false, error: `section-not-found:${id}` }
    spans.set(id, lines.slice(span.start, span.end).join('\n'))
  }

  const body = order.map((id) => spans.get(id)).join('\n')
  const content = prelude ? `${prelude}\n${body}` : body
  return { ok: true, value: content }
}
