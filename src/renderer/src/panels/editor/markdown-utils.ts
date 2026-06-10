/**
 * Markdown preprocessing utilities for the editor.
 * Handles frontmatter extraction and re-serialization.
 */

export type PropertyValue = string | number | boolean | readonly string[]

const ESCAPE_MAP: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' }

/** Strip surrounding quotes from a YAML scalar token and unescape. Inverse of `encodeScalar`. */
function decodeQuoted(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(.)/g, (_, c) => ESCAPE_MAP[c] ?? c)
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  return raw
}

/** Parse a YAML scalar value, preserving booleans and numbers. Quoted values stay strings. */
function parseScalarValue(raw: string): string | number | boolean {
  const isQuoted =
    (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
  if (isQuoted) return decodeQuoted(raw)

  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)

  return raw
}

interface ParsedFrontmatter {
  /** Raw YAML block including delimiters, for lossless round-tripping */
  readonly raw: string
  /** Parsed key-value pairs for display in properties panel (type-preserving) */
  readonly data: Readonly<Record<string, PropertyValue>>
  /** Document body with frontmatter stripped */
  readonly body: string
}

// ── YAML block segmentation ──
//
// The properties panel must never destroy structures it cannot represent
// (nested maps, block scalars, comments). Both parsing and patching run on the
// same line-level segmentation of the raw YAML text: each top-level key owns
// its line plus all continuation lines; everything else (comments, blanks) is
// a free segment preserved verbatim. Edits replace exactly one entry's lines.

interface YamlSegment {
  readonly kind: 'entry' | 'free'
  /** Top-level key for entry segments, null for free segments */
  readonly key: string | null
  readonly lines: readonly string[]
}

const TOP_LEVEL_KEY_RE = /^([\w][\w\s-]*):\s*(.*)$/
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*(?:\s+#.*)?$/

function segmentYaml(yaml: string): readonly YamlSegment[] {
  if (yaml === '') return []
  const lines = yaml.split('\n')
  const segments: YamlSegment[] = []
  let i = 0
  while (i < lines.length) {
    const match = lines[i].trimEnd().match(TOP_LEVEL_KEY_RE)
    if (!match) {
      // Top-level comment/blank/unrecognized line — preserved verbatim
      segments.push({ kind: 'free', key: null, lines: [lines[i]] })
      i++
      continue
    }
    // Consume continuation lines: indented lines, plus blank lines that are
    // followed by more indented content (block scalars with internal blanks)
    let j = i + 1
    while (j < lines.length) {
      if (/^[ \t]/.test(lines[j])) {
        j++
        continue
      }
      if (lines[j].trim() === '') {
        let k = j + 1
        while (k < lines.length && lines[k].trim() === '') k++
        if (k < lines.length && /^[ \t]/.test(lines[k])) {
          j = k
          continue
        }
      }
      break
    }
    segments.push({ kind: 'entry', key: match[1].trim(), lines: lines.slice(i, j) })
    i = j
  }
  return segments
}

/**
 * Parse one entry into an editable PropertyValue, or undefined when the value
 * is a structure the properties panel cannot edit losslessly (nested map,
 * block scalar, flow map, multi-line value). Complex entries are hidden from
 * the panel; the raw patchers below leave their lines untouched.
 */
function parseEntryValue(entry: YamlSegment): PropertyValue | undefined {
  const match = entry.lines[0].trimEnd().match(TOP_LEVEL_KEY_RE)
  if (!match) return undefined
  const inline = match[2]
  const cont = entry.lines.slice(1).filter((l) => l.trim() !== '')

  if (BLOCK_SCALAR_RE.test(inline)) return undefined

  if (inline === '') {
    if (cont.length === 0) return [] // bare `key:` — shown as an empty list
    if (cont.every((l) => /^\s+-\s/.test(l.trimEnd()))) {
      return cont.map((l) => decodeQuoted(l.trimEnd().replace(/^\s+-\s*/, '')))
    }
    return undefined // nested map or other block structure
  }

  if (cont.length > 0) return undefined // multi-line non-list value
  if (inline.startsWith('{')) return undefined // flow map
  if (inline.startsWith('[')) {
    if (!inline.endsWith(']')) return undefined // multi-line flow sequence
    return inline
      .slice(1, -1)
      .split(',')
      .map((s) => decodeQuoted(s.trim()))
      .filter(Boolean)
  }
  return parseScalarValue(inline)
}

/**
 * Extract YAML frontmatter from markdown content.
 * Returns parsed data for display and the raw block for lossless re-serialization.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { raw: '', data: {}, body: content }
  }

  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return { raw: '', data: {}, body: content }

  const afterClosing = endIdx + 4 // position after `\n---`
  // Count leading newlines between closing delimiter and body
  const leadingMatch = content.slice(afterClosing).match(/^[\r\n]*/)
  const leadingLen = leadingMatch ? leadingMatch[0].length : 0
  // Raw includes everything up to where body starts (for lossless round-tripping)
  const rawBlock = content.slice(0, afterClosing + leadingLen)
  const yamlContent = content.slice(4, endIdx)
  const body = content.slice(afterClosing + leadingLen)

  const data: Record<string, PropertyValue> = {}
  for (const segment of segmentYaml(yamlContent)) {
    if (segment.kind !== 'entry' || segment.key === null) continue
    const value = parseEntryValue(segment)
    if (value !== undefined) data[segment.key] = value
  }

  return { raw: rawBlock, data, body }
}

/**
 * A plain (unquoted) YAML scalar gets reinterpreted on reparse when it looks
 * like a null, boolean, number, or timestamp (js-yaml, via gray-matter, coerces
 * it off the string type), or when it carries a YAML-significant character or
 * surrounding whitespace. Those must be double-quoted to round-trip as strings.
 * Modeled per YAML type rather than one catch-all regex, which silently missed
 * 1e10, .5, +5, 0x1F, 1_000, .inf/.nan, and bare dates (string -> number/Date
 * on the main-process reparse). frontmatter-gray-matter-roundtrip.test.ts locks
 * the exact cases against the real gray-matter path.
 */
const YAML_SIGNIFICANT = /[:#[\]{}&*!|>'"%@`,]|^[\s?-]|\s$/
const YAML_NULL = /^(?:null|~)$/i
const YAML_BOOL = /^(?:true|false)$/i
const YAML_NUMBER =
  /^[-+]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][-+]?\d+)?|\.(?:inf|nan))$/i
const YAML_TIMESTAMP = /^\d{4}-\d\d?-\d\d?(?:[Tt ].*)?$/

function needsQuote(value: string): boolean {
  return (
    value === '' ||
    YAML_SIGNIFICANT.test(value) ||
    YAML_NULL.test(value) ||
    YAML_BOOL.test(value) ||
    YAML_NUMBER.test(value) ||
    YAML_TIMESTAMP.test(value)
  )
}

/** Serialize one scalar to a YAML token. Inverse of `parseScalarValue` + `decodeQuoted`. */
function encodeScalar(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (needsQuote(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  return value
}

/** Serialize one key-value pair to YAML lines. Shared by full and patch serialization. */
function entryLines(key: string, value: PropertyValue): readonly string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}:`]
    return [`${key}:`, ...value.map((v) => `  - ${encodeScalar(v)}`)]
  }
  return [`${key}: ${encodeScalar(value as string | number | boolean)}`]
}

/**
 * Serialize frontmatter data to a fresh raw YAML block. Used when a note has
 * no frontmatter yet; existing blocks are patched in place (`setFrontmatterValue`,
 * `deleteFrontmatterKey`) so structures the panel can't represent survive.
 * Output must round-trip through both `parseFrontmatter` and the main-process
 * gray-matter reparse. Scalars are quoted when unsafe (`encodeScalar`).
 */
export function serializeFrontmatter(data: Record<string, PropertyValue>): string {
  const entries = Object.entries(data)
  if (entries.length === 0) return ''

  const lines = entries.flatMap(([key, value]) => entryLines(key, value))
  return `---\n${lines.join('\n')}\n---\n`
}

// ── Raw-text patching (lossless property edits) ──

interface RawBlockParts {
  /** Opening delimiter through its newline */
  readonly before: string
  /** Inner YAML text (no surrounding newlines beyond what the lines carry) */
  readonly yaml: string
  /** Closing `\n---` plus any trailing newlines before the body */
  readonly after: string
}

function splitRawBlock(raw: string): RawBlockParts | null {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return null
  const endIdx = raw.indexOf('\n---', 3)
  if (endIdx === -1) return null
  return { before: raw.slice(0, 4), yaml: raw.slice(4, endIdx), after: raw.slice(endIdx) }
}

/**
 * Set one key in a raw frontmatter block, replacing only that key's lines.
 * Every other line — nested maps, block scalars, comments, formatting — is
 * preserved byte for byte. Missing keys are appended; an empty/absent block
 * is created fresh.
 */
export function setFrontmatterValue(raw: string, key: string, value: PropertyValue): string {
  const block = splitRawBlock(raw)
  if (!block) return serializeFrontmatter({ [key]: value })

  const segments = segmentYaml(block.yaml)
  const replacement = entryLines(key, value)
  // Duplicate keys: patch the last occurrence (matches "last wins" parse display)
  let targetIdx = -1
  segments.forEach((segment, idx) => {
    if (segment.kind === 'entry' && segment.key === key) targetIdx = idx
  })

  const lines: string[] = []
  segments.forEach((segment, idx) => {
    lines.push(...(idx === targetIdx ? replacement : segment.lines))
  })
  if (targetIdx === -1) lines.push(...replacement)

  return block.before + lines.join('\n') + block.after
}

/**
 * Delete one key (all its lines) from a raw frontmatter block, leaving every
 * other line verbatim. Returns '' when nothing meaningful remains, removing
 * the block entirely.
 */
export function deleteFrontmatterKey(raw: string, key: string): string {
  const block = splitRawBlock(raw)
  if (!block) return raw

  const kept = segmentYaml(block.yaml).filter(
    (segment) => !(segment.kind === 'entry' && segment.key === key)
  )
  if (!kept.some((segment) => segment.lines.some((line) => line.trim() !== ''))) return ''

  const lines = kept.flatMap((segment) => [...segment.lines])
  return block.before + lines.join('\n') + block.after
}
