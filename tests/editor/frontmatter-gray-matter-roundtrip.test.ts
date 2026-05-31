// @vitest-environment node
//
// Guards C1: serializeFrontmatter runs on every property edit and its output is
// reparsed by the main process via gray-matter (src/shared/engine/parser.ts).
// These cases corrupted the file before the fix (gray-matter threw or mis-typed).
import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { serializeFrontmatter } from '../../src/renderer/src/panels/editor/markdown-utils'

// Mirror parser.ts SAFE_MATTER_OPTIONS so this tests the real main-process parse.
const SAFE = {
  engines: {
    javascript: { parse: (): Record<string, unknown> => ({}), stringify: (): string => '' }
  }
}

const reparse = (raw: string) => matter(raw + 'body', SAFE).data

describe('serializeFrontmatter → gray-matter reparse (C1)', () => {
  it('the OLD unquoted form would have corrupted a colon value', () => {
    // What the buggy serializer emitted: `title: Notes: part 2` — invalid YAML.
    expect(() => matter('---\ntitle: Notes: part 2\n---\nbody', SAFE)).toThrow()
  })

  it.each([
    ['colon value', { title: 'Notes: part 2' }, { title: 'Notes: part 2' }],
    ['url-ish', { link: 'https://x.com/a' }, { link: 'https://x.com/a' }],
    ['leading bracket', { v: '[wip]' }, { v: '[wip]' }],
    ['hash', { v: '#tag' }, { v: '#tag' }],
    ['quotes inside', { v: 'said "hi"' }, { v: 'said "hi"' }],
    ['backslash path', { v: 'C:\\a\\b' }, { v: 'C:\\a\\b' }],
    ['number-looking string', { zip: '90210' }, { zip: '90210' }],
    ['bool-looking string', { label: 'true' }, { label: 'true' }],
    ['array w/ specials', { tags: ['a: b', '#x', 'ok'] }, { tags: ['a: b', '#x', 'ok'] }]
  ])('reparses %s losslessly through gray-matter', (_l, input, expected) => {
    expect(reparse(serializeFrontmatter(input))).toEqual(expected)
  })

  it('number/bool-looking strings stay strings (not coerced) after gray-matter', () => {
    expect(typeof reparse(serializeFrontmatter({ zip: '90210' })).zip).toBe('string')
    expect(typeof reparse(serializeFrontmatter({ label: 'true' })).label).toBe('string')
  })

  it('preserves real numbers and booleans as their type', () => {
    const out = reparse(serializeFrontmatter({ order: 42, draft: true }))
    expect(out.order).toBe(42)
    expect(out.draft).toBe(true)
  })
})
