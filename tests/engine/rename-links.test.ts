import { describe, it, expect } from 'vitest'
import { rewriteWikilinks } from '../../src/renderer/src/engine/rename-links'

describe('rewriteWikilinks', () => {
  it('replaces a simple wikilink', () => {
    expect(rewriteWikilinks('see [[Foo]] for details', 'Foo', 'Bar')).toBe(
      'see [[Bar]] for details'
    )
  })

  it('preserves display alias', () => {
    expect(rewriteWikilinks('see [[Foo|my foo note]]', 'Foo', 'Bar')).toBe(
      'see [[Bar|my foo note]]'
    )
  })

  it('replaces multiple occurrences', () => {
    const input = '[[Foo]] links to [[Foo]] and [[Foo|alias]]'
    expect(rewriteWikilinks(input, 'Foo', 'Bar')).toBe('[[Bar]] links to [[Bar]] and [[Bar|alias]]')
  })

  it('does not touch other wikilinks', () => {
    expect(rewriteWikilinks('[[Foo]] and [[Baz]]', 'Foo', 'Bar')).toBe('[[Bar]] and [[Baz]]')
  })

  it('handles names with regex special characters', () => {
    expect(rewriteWikilinks('see [[C++ (lang)]]', 'C++ (lang)', 'CPP')).toBe('see [[CPP]]')
  })

  it('returns unchanged content when no match', () => {
    const input = 'no links here'
    expect(rewriteWikilinks(input, 'Foo', 'Bar')).toBe(input)
  })

  it('handles frontmatter related field with brackets', () => {
    const input = 'related: ["[[Foo]]", "[[Other]]"]'
    expect(rewriteWikilinks(input, 'Foo', 'Bar')).toBe('related: ["[[Bar]]", "[[Other]]"]')
  })

  it('handles wikilink with empty alias pipe', () => {
    expect(rewriteWikilinks('[[Foo|]]', 'Foo', 'Bar')).toBe('[[Bar|]]')
  })

  it('replaces case-insensitively: [[foo]], [[FOO]], [[Foo]]', () => {
    const input = '[[OldName]] and [[oldname]] and [[OLDNAME]]'
    expect(rewriteWikilinks(input, 'OldName', 'newname')).toBe(
      '[[newname]] and [[newname]] and [[newname]]'
    )
  })

  it('replaces case-insensitive with alias', () => {
    expect(rewriteWikilinks('[[oldname|My Note]]', 'OldName', 'newname')).toBe(
      '[[newname|My Note]]'
    )
  })

  it('replaces path-prefixed wikilinks', () => {
    expect(rewriteWikilinks('see [[archive/OldName]]', 'OldName', 'newname')).toBe(
      'see [[archive/newname]]'
    )
  })

  it('replaces path-prefixed wikilinks with alias', () => {
    expect(rewriteWikilinks('see [[docs/OldName|display]]', 'OldName', 'newname')).toBe(
      'see [[docs/newname|display]]'
    )
  })

  it('preserves path prefix on case-insensitive path match', () => {
    expect(rewriteWikilinks('[[Archive/oldname]]', 'OldName', 'newname')).toBe(
      '[[Archive/newname]]'
    )
  })

  it('handles deeply nested path prefixes', () => {
    expect(rewriteWikilinks('[[a/b/c/OldName]]', 'OldName', 'newname')).toBe('[[a/b/c/newname]]')
  })

  it('rewrites a heading-anchored link and preserves the anchor', () => {
    expect(rewriteWikilinks('see [[Old#Section]]', 'Old', 'New')).toBe('see [[New#Section]]')
  })

  it('rewrites a block-ref-anchored link and preserves the anchor', () => {
    expect(rewriteWikilinks('see [[Old#^abc123]]', 'Old', 'New')).toBe('see [[New#^abc123]]')
  })

  it('rewrites an anchored link with an alias', () => {
    expect(rewriteWikilinks('[[Old#Section|display]]', 'Old', 'New')).toBe(
      '[[New#Section|display]]'
    )
  })

  it('rewrites a path-prefixed anchored link', () => {
    expect(rewriteWikilinks('[[docs/Old#Section]]', 'Old', 'New')).toBe('[[docs/New#Section]]')
  })

  it('rewrites a path-prefixed anchored link with an alias', () => {
    expect(rewriteWikilinks('[[docs/Old#Heading|disp]]', 'Old', 'New')).toBe(
      '[[docs/New#Heading|disp]]'
    )
  })

  it('preserves an empty anchor', () => {
    expect(rewriteWikilinks('[[Old#]]', 'Old', 'New')).toBe('[[New#]]')
  })

  it('does not match a longer stem when renaming an anchored link', () => {
    // Renaming 'Old' must not touch '[[Older#X]]' or '[[OldThing#Y]]'.
    expect(rewriteWikilinks('[[Older#X]] and [[OldThing#Y]]', 'Old', 'New')).toBe(
      '[[Older#X]] and [[OldThing#Y]]'
    )
  })
})
