import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  migrateLegacyWikilinks,
  serializeFrontmatter
} from '../../src/renderer/src/panels/editor/markdown-utils'

// --- parseFrontmatter ---

describe('parseFrontmatter', () => {
  it('returns empty data and full content when no frontmatter exists', () => {
    const result = parseFrontmatter('# Hello World\n\nSome text.')
    expect(result.data).toEqual({})
    expect(result.body).toBe('# Hello World\n\nSome text.')
    expect(result.raw).toBe('')
  })

  it('extracts simple key-value pairs', () => {
    const md = '---\ntitle: My Note\nauthor: Casey\n---\n\n# Body'
    const result = parseFrontmatter(md)
    expect(result.data).toEqual({ title: 'My Note', author: 'Casey' })
    expect(result.body).toBe('# Body')
    expect(result.raw).toContain('---')
  })

  it('extracts block-style arrays (YAML list tags)', () => {
    const md = '---\ntags:\n  - thinking\n  - writing\n  - tools\n---\n\nContent here.'
    const result = parseFrontmatter(md)
    expect(result.data.tags).toEqual(['thinking', 'writing', 'tools'])
    expect(result.body).toBe('Content here.')
  })

  it('extracts inline arrays', () => {
    const md = '---\naliases: [note-alias, other-name]\n---\n\nBody text.'
    const result = parseFrontmatter(md)
    expect(result.data.aliases).toEqual(['note-alias', 'other-name'])
  })

  it('strips quoted values', () => {
    const md = '---\ntitle: "My Title"\nauthor: \'Casey\'\n---\n\nBody.'
    const result = parseFrontmatter(md)
    expect(result.data.title).toBe('My Title')
    expect(result.data.author).toBe('Casey')
  })

  it('handles missing closing delimiter', () => {
    const md = '---\ntitle: Broken\nNo closing delimiter'
    const result = parseFrontmatter(md)
    expect(result.data).toEqual({})
    expect(result.body).toBe(md)
  })

  it('handles empty frontmatter', () => {
    const md = '---\n---\n\nJust body.'
    const result = parseFrontmatter(md)
    expect(result.data).toEqual({})
    expect(result.body).toBe('Just body.')
  })

  it('preserves raw frontmatter for round-tripping', () => {
    const yaml = '---\ntitle: Test\ntags:\n  - a\n  - b\n---\n'
    const md = yaml + '\nBody content.'
    const result = parseFrontmatter(md)
    // Raw includes frontmatter + separator newlines so raw + body === original
    expect(result.raw + result.body).toBe(md)
    expect(result.body).toBe('Body content.')
  })

  it('handles content not starting with ---', () => {
    const result = parseFrontmatter('Just regular text.\n---\nThis is not frontmatter.')
    expect(result.data).toEqual({})
    expect(result.body).toBe('Just regular text.\n---\nThis is not frontmatter.')
  })
})

// --- migrateLegacyWikilinks ---

describe('migrateLegacyWikilinks', () => {
  it('converts simple wikilinks to concept nodes', () => {
    const result = migrateLegacyWikilinks('See [[My Note]] for details.')
    expect(result).toBe('See <node>My Note</node> for details.')
  })

  it('converts piped wikilinks using target (not display)', () => {
    const result = migrateLegacyWikilinks('Check [[Target Page|display text]] here.')
    expect(result).toBe('Check <node>Target Page</node> here.')
  })

  it('handles multiple wikilinks in one line', () => {
    const result = migrateLegacyWikilinks('Links: [[A]], [[B]], and [[C]].')
    expect(result).toBe('Links: <node>A</node>, <node>B</node>, and <node>C</node>.')
  })

  it('leaves text without wikilinks unchanged', () => {
    const text = 'No wikilinks here, just [regular](link).'
    expect(migrateLegacyWikilinks(text)).toBe(text)
  })

  it('leaves existing concept nodes unchanged', () => {
    const text = 'Already <node>migrated</node> content.'
    expect(migrateLegacyWikilinks(text)).toBe(text)
  })

  it('handles mixed legacy and new syntax', () => {
    const text = 'Old [[legacy]] and new <node>modern</node>.'
    expect(migrateLegacyWikilinks(text)).toBe(
      'Old <node>legacy</node> and new <node>modern</node>.'
    )
  })

  it('trims whitespace from targets', () => {
    const result = migrateLegacyWikilinks('See [[ spaced target ]] here.')
    expect(result).toBe('See <node>spaced target</node> here.')
  })
})

// --- Type-preserving parse ---

describe('parseFrontmatter type preservation', () => {
  it('preserves boolean true', () => {
    const md = '---\ndraft: true\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.draft).toBe(true)
    expect(typeof result.data.draft).toBe('boolean')
  })

  it('preserves boolean false', () => {
    const md = '---\npublished: false\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.published).toBe(false)
    expect(typeof result.data.published).toBe('boolean')
  })

  it('preserves integer numbers', () => {
    const md = '---\norder: 42\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.order).toBe(42)
    expect(typeof result.data.order).toBe('number')
  })

  it('preserves float numbers', () => {
    const md = '---\nweight: 3.14\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.weight).toBe(3.14)
    expect(typeof result.data.weight).toBe('number')
  })

  it('preserves negative numbers', () => {
    const md = '---\noffset: -7\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.offset).toBe(-7)
  })

  it('keeps quoted "true" as string', () => {
    const md = '---\nlabel: "true"\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.label).toBe('true')
    expect(typeof result.data.label).toBe('string')
  })

  it('keeps quoted number as string', () => {
    const md = "---\nzip: '90210'\n---\n\nBody"
    const result = parseFrontmatter(md)
    expect(result.data.zip).toBe('90210')
    expect(typeof result.data.zip).toBe('string')
  })

  it('preserves date strings as strings', () => {
    const md = '---\ncreated: 2026-04-06\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.created).toBe('2026-04-06')
    expect(typeof result.data.created).toBe('string')
  })

  it('preserves mixed types in same frontmatter', () => {
    const md = '---\ntitle: My Note\ndraft: true\norder: 3\ntags:\n  - a\n  - b\n---\n\nBody'
    const result = parseFrontmatter(md)
    expect(result.data.title).toBe('My Note')
    expect(result.data.draft).toBe(true)
    expect(result.data.order).toBe(3)
    expect(result.data.tags).toEqual(['a', 'b'])
  })
})

// --- serializeFrontmatter ---

describe('serializeFrontmatter', () => {
  it('serializes simple key-value pairs', () => {
    const result = serializeFrontmatter({ title: 'Test', author: 'Casey' })
    expect(result).toBe('---\ntitle: Test\nauthor: Casey\n---\n')
  })

  it('serializes arrays as block YAML', () => {
    const result = serializeFrontmatter({ tags: ['a', 'b', 'c'] })
    expect(result).toContain('tags:\n  - a\n  - b\n  - c')
  })

  it('returns empty string for empty data', () => {
    expect(serializeFrontmatter({})).toBe('')
  })

  it('serializes boolean values', () => {
    const result = serializeFrontmatter({ draft: true, published: false })
    expect(result).toContain('draft: true')
    expect(result).toContain('published: false')
  })

  it('serializes number values', () => {
    const result = serializeFrontmatter({ order: 42, weight: 3.14 })
    expect(result).toContain('order: 42')
    expect(result).toContain('weight: 3.14')
  })

  it('round-trips typed values through parse → serialize → parse', () => {
    const original = '---\ntitle: Test\ndraft: true\norder: 5\ntags:\n  - x\n  - y\n---\n'
    const parsed = parseFrontmatter(original + '\nBody')
    const reserialized = serializeFrontmatter(
      parsed.data as Record<string, string | number | boolean | readonly string[]>
    )
    const reparsed = parseFrontmatter(reserialized + '\nBody')
    expect(reparsed.data.title).toBe('Test')
    expect(reparsed.data.draft).toBe(true)
    expect(reparsed.data.order).toBe(5)
    expect(reparsed.data.tags).toEqual(['x', 'y'])
  })

  // --- Regression: values with YAML-significant chars must not corrupt on reparse (C1) ---

  it('quotes a value containing a colon so it reparses intact', () => {
    const result = serializeFrontmatter({ title: 'Notes: part 2' })
    expect(result).toBe('---\ntitle: "Notes: part 2"\n---\n')
    expect(parseFrontmatter(result + '\nBody').data.title).toBe('Notes: part 2')
  })

  it.each([
    ['colon', 'a: b'],
    ['leading bracket', '[draft]'],
    ['leading brace', '{x}'],
    ['hash', '#tag'],
    ['leading dash', '- bullet'],
    ['quotes inside', 'she said "hi"'],
    ['backslash', 'C:\\path'],
    ['leading/trailing space', '  spaced  '],
    ['empty string', ''],
    ['number-looking string', '90210'],
    ['bool-looking string', 'true'],
    ['comma', 'a, b, c'],
    ['exponent-looking string', '1e10'],
    ['leading-dot number', '.5'],
    ['plus-signed number', '+5'],
    ['hex-looking string', '0x1F'],
    ['underscored number', '1_000'],
    ['special float', '.inf'],
    ['bare date', '2026-04-06']
  ])('round-trips a string value with %s', (_label, value) => {
    const out = serializeFrontmatter({ field: value })
    expect(parseFrontmatter(out + '\nBody').data.field).toBe(value)
    // number/bool-looking strings must stay strings, not coerce
    expect(typeof parseFrontmatter(out + '\nBody').data.field).toBe('string')
  })

  it('round-trips array items containing significant chars', () => {
    const out = serializeFrontmatter({ tags: ['a: b', '#x', 'plain'] })
    expect(parseFrontmatter(out + '\nBody').data.tags).toEqual(['a: b', '#x', 'plain'])
  })

  it('keeps plain alphanumeric values unquoted (no formatting churn)', () => {
    const out = serializeFrontmatter({ title: 'My Note', slug: 'my-note', n: 5, b: true })
    expect(out).toContain('title: My Note')
    expect(out).toContain('slug: my-note')
    expect(out).toContain('n: 5')
    expect(out).toContain('b: true')
  })

  it('quotes string values that would coerce to a number or date on reparse', () => {
    const out = serializeFrontmatter({ created: '2026-04-06', big: '1e10', frac: '.5' })
    expect(out).toContain('created: "2026-04-06"')
    expect(out).toContain('big: "1e10"')
    expect(out).toContain('frac: ".5"')
  })
})
