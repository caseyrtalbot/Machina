/**
 * Markdown preprocessing utilities for the editor.
 * Handles frontmatter extraction and legacy wikilink migration.
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
  let currentKey: string | null = null
  let currentList: string[] | null = null

  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trimEnd()

    // Array item under a key
    if (/^\s+-\s/.test(trimmed) && currentKey) {
      if (!currentList) currentList = []
      currentList.push(decodeQuoted(trimmed.replace(/^\s+-\s*/, '')))
      continue
    }

    // Flush pending array
    if (currentKey && currentList) {
      data[currentKey] = currentList
      currentKey = null
      currentList = null
    }

    // Key: value pair
    const match = trimmed.match(/^([\w][\w\s-]*):\s*(.*)$/)
    if (!match) continue

    const [, key, value] = match
    const k = key.trim()

    if (value === '' || value === undefined) {
      // Start of block array or empty value
      currentKey = k
      currentList = []
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: [a, b, c]
      data[k] = value
        .slice(1, -1)
        .split(',')
        .map((s) => decodeQuoted(s.trim()))
        .filter(Boolean)
    } else {
      data[k] = parseScalarValue(value)
    }
  }

  // Flush trailing array
  if (currentKey && currentList) {
    data[currentKey] = currentList
  }

  return { raw: rawBlock, data, body }
}

/**
 * Migrate legacy [[wikilink]] syntax to `<node>` concept nodes.
 * Handles both [[target]] and [[target|display]] forms (uses target, not display).
 * Idempotent: content already using `<node>` tags is unaffected.
 */
export function migrateLegacyWikilinks(markdown: string): string {
  return markdown.replace(
    /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g,
    (_m, target) => `<node>${target.trim()}</node>`
  )
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

/**
 * Serialize frontmatter data back to a raw YAML block.
 * Runs on every property edit (FrontmatterHeader.dispatchChange), so it must
 * produce YAML that round-trips through both `parseFrontmatter` and the
 * main-process gray-matter reparse. Scalars are quoted when unsafe (`encodeScalar`).
 */
export function serializeFrontmatter(data: Record<string, PropertyValue>): string {
  const entries = Object.entries(data)
  if (entries.length === 0) return ''

  const lines = entries.map(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) return `${key}:`
      return `${key}:\n${value.map((v) => `  - ${encodeScalar(v)}`).join('\n')}`
    }
    return `${key}: ${encodeScalar(value as string | number | boolean)}`
  })

  return `---\n${lines.join('\n')}\n---\n`
}
