import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  preprocessWikilinks,
  postprocessWikilinks,
  serializeFrontmatter
} from '../../src/renderer/src/panels/editor/markdown-utils'

// ─── parseFrontmatter ────────────────────────────────────────────────────────

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

  it('extracts block-style arrays (Obsidian tags)', () => {
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

// ─── preprocessWikilinks ─────────────────────────────────────────────────────

describe('preprocessWikilinks', () => {
  it('converts simple wikilinks to markdown links', () => {
    const result = preprocessWikilinks('See [[My Note]] for details.')
    expect(result).toBe('See [My Note](wikilink:My%20Note) for details.')
  })

  it('converts piped wikilinks with display text', () => {
    const result = preprocessWikilinks('Check [[Target Page|display text]] here.')
    expect(result).toBe('Check [display text](wikilink:Target%20Page) here.')
  })

  it('handles multiple wikilinks in one line', () => {
    const result = preprocessWikilinks('Links: [[A]], [[B]], and [[C]].')
    expect(result).toContain('[A](wikilink:A)')
    expect(result).toContain('[B](wikilink:B)')
    expect(result).toContain('[C](wikilink:C)')
  })

  it('leaves text without wikilinks unchanged', () => {
    const text = 'No wikilinks here, just [regular](link).'
    expect(preprocessWikilinks(text)).toBe(text)
  })

  it('handles wikilinks with special characters', () => {
    const result = preprocessWikilinks('See [[Note (2024)]] for details.')
    expect(result).toBe('See [Note (2024)](wikilink:Note%20(2024)) for details.')
  })
})

// ─── postprocessWikilinks ────────────────────────────────────────────────────

describe('postprocessWikilinks', () => {
  it('converts wikilink-scheme links back to wikilink syntax', () => {
    const result = postprocessWikilinks('[My Note](wikilink:My%20Note)')
    expect(result).toBe('[[My Note]]')
  })

  it('restores piped wikilinks when display differs from target', () => {
    const result = postprocessWikilinks('[display text](wikilink:Target%20Page)')
    expect(result).toBe('[[Target Page|display text]]')
  })

  it('round-trips simple wikilinks correctly', () => {
    const original = 'See [[My Note]] and [[Other Note]] for more.'
    const processed = preprocessWikilinks(original)
    const restored = postprocessWikilinks(processed)
    expect(restored).toBe(original)
  })

  it('round-trips piped wikilinks correctly', () => {
    const original = 'See [[Target|custom label]] for details.'
    const processed = preprocessWikilinks(original)
    const restored = postprocessWikilinks(processed)
    expect(restored).toBe(original)
  })

  it('leaves non-wikilink markdown links unchanged', () => {
    const text = '[Click here](https://example.com)'
    expect(postprocessWikilinks(text)).toBe(text)
  })
})

// ─── serializeFrontmatter ────────────────────────────────────────────────────

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
})
