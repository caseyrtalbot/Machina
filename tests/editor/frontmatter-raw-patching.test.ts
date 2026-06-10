// @vitest-environment node
//
// Item 1.2: frontmatter property edits must round-trip YAML. Property edits
// patch only the changed key's lines in the raw block; nested maps, block
// scalars, and comments survive verbatim. Patched output must still parse
// under the main process's gray-matter reparse.
import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import {
  parseFrontmatter,
  setFrontmatterValue,
  deleteFrontmatterKey
} from '../../src/renderer/src/panels/editor/markdown-utils'

// Mirror parser.ts SAFE_MATTER_OPTIONS so this tests the real main-process parse.
const SAFE = {
  engines: {
    javascript: { parse: (): Record<string, unknown> => ({}), stringify: (): string => '' }
  }
}

const reparse = (raw: string) => matter(raw + 'body', SAFE).data

describe('setFrontmatterValue — lossless patching', () => {
  it('editing one key preserves a nested map verbatim', () => {
    const raw = '---\ntitle: Old\nmeta:\n  author: casey\n  year: 2020\n---\n'
    const out = setFrontmatterValue(raw, 'title', 'New')
    expect(out).toBe('---\ntitle: New\nmeta:\n  author: casey\n  year: 2020\n---\n')
    expect(reparse(out)).toEqual({ title: 'New', meta: { author: 'casey', year: 2020 } })
  })

  it('editing one key preserves a literal block scalar (|) including internal blank lines', () => {
    const raw = '---\ndesc: |\n  line one\n\n  line two\ntitle: A\n---\n'
    const out = setFrontmatterValue(raw, 'title', 'B')
    expect(out).toBe('---\ndesc: |\n  line one\n\n  line two\ntitle: B\n---\n')
    expect(reparse(out).desc).toBe('line one\n\nline two\n')
  })

  it('editing one key preserves a folded block scalar (>)', () => {
    const raw = '---\nsummary: >\n  folded\n  text\ncount: 1\n---\n'
    const out = setFrontmatterValue(raw, 'count', 2)
    expect(out).toBe('---\nsummary: >\n  folded\n  text\ncount: 2\n---\n')
    expect(reparse(out).summary).toBe('folded text\n')
  })

  it('editing one key preserves comments and blank lines', () => {
    const raw = '---\n# pinned comment\ntitle: Old\n\n# trailing comment\ntags:\n  - a\n---\n'
    const out = setFrontmatterValue(raw, 'title', 'New')
    expect(out).toBe('---\n# pinned comment\ntitle: New\n\n# trailing comment\ntags:\n  - a\n---\n')
  })

  it('replacing a list rewrites only that list', () => {
    const raw = '---\n# keep\ntags:\n  - a\n  - b\ntitle: T\n---\n'
    const out = setFrontmatterValue(raw, 'tags', ['x', 'y'])
    expect(out).toBe('---\n# keep\ntags:\n  - x\n  - y\ntitle: T\n---\n')
  })

  it('appends a missing key without touching existing lines', () => {
    const raw = '---\nmeta:\n  a: 1\n---\n'
    const out = setFrontmatterValue(raw, 'draft', false)
    expect(out).toBe('---\nmeta:\n  a: 1\ndraft: false\n---\n')
    expect(reparse(out)).toEqual({ meta: { a: 1 }, draft: false })
  })

  it('creates a fresh block when no frontmatter exists', () => {
    expect(setFrontmatterValue('', 'title', 'New')).toBe('---\ntitle: New\n---\n')
  })

  it('quotes unsafe scalars so the patched block reparses intact', () => {
    const raw = '---\nmeta:\n  a: 1\n---\n'
    const out = setFrontmatterValue(raw, 'title', 'Notes: part 2')
    expect(out).toContain('title: "Notes: part 2"')
    expect(reparse(out).title).toBe('Notes: part 2')
  })

  it('preserves trailing separator newlines after the closing delimiter', () => {
    const raw = '---\ntitle: Old\n---\n\n'
    const out = setFrontmatterValue(raw, 'title', 'New')
    expect(out).toBe('---\ntitle: New\n---\n\n')
  })

  it('full edit cycle: parse → edit one property → reparse keeps every other structure', () => {
    const md =
      '---\n# header comment\ntitle: Old\nmeta:\n  nested: true\nnotes: |\n  body text\ntags:\n  - a\n---\nBody.'
    const { raw } = parseFrontmatter(md)
    const out = setFrontmatterValue(raw, 'title', 'New')
    const data = reparse(out)
    expect(data.title).toBe('New')
    expect(data.meta).toEqual({ nested: true })
    expect(data.notes).toBe('body text\n')
    expect(data.tags).toEqual(['a'])
    expect(out).toContain('# header comment')
  })
})

describe('deleteFrontmatterKey — lossless patching', () => {
  it('removes only the target key, keeping comments and complex structures', () => {
    const raw = '---\n# comment\ntitle: T\nmeta:\n  a: 1\n---\n'
    const out = deleteFrontmatterKey(raw, 'title')
    expect(out).toBe('---\n# comment\nmeta:\n  a: 1\n---\n')
  })

  it('removes a block list entirely', () => {
    const raw = '---\ntags:\n  - a\n  - b\ntitle: T\n---\n'
    expect(deleteFrontmatterKey(raw, 'tags')).toBe('---\ntitle: T\n---\n')
  })

  it('returns empty string when the last meaningful entry is deleted', () => {
    expect(deleteFrontmatterKey('---\ntitle: T\n---\n', 'title')).toBe('')
  })

  it('keeps the block when comments remain after deletion', () => {
    const out = deleteFrontmatterKey('---\n# keep me\ntitle: T\n---\n', 'title')
    expect(out).toBe('---\n# keep me\n---\n')
  })

  it('is a no-op without a frontmatter block', () => {
    expect(deleteFrontmatterKey('', 'title')).toBe('')
  })
})

describe('parseFrontmatter — complex values are hidden, not mangled', () => {
  it('excludes nested maps from editable data (previously shown as an empty list)', () => {
    const { data } = parseFrontmatter('---\nmeta:\n  a: 1\ntitle: T\n---\nBody')
    expect(data).toEqual({ title: 'T' })
  })

  it('excludes block scalars from editable data (previously shown as "|")', () => {
    const { data } = parseFrontmatter('---\ndesc: |\n  text\ntitle: T\n---\nBody')
    expect(data).toEqual({ title: 'T' })
  })

  it('excludes flow maps from editable data', () => {
    const { data } = parseFrontmatter('---\npos: { x: 1, y: 2 }\ntitle: T\n---\nBody')
    expect(data).toEqual({ title: 'T' })
  })

  it('still parses flat scalars, inline arrays, and block lists', () => {
    const { data } = parseFrontmatter(
      '---\ntitle: T\nn: 3\nok: true\naliases: [a, b]\ntags:\n  - x\n---\nBody'
    )
    expect(data).toEqual({ title: 'T', n: 3, ok: true, aliases: ['a', 'b'], tags: ['x'] })
  })
})
