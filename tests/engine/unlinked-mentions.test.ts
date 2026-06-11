import { describe, it, expect } from 'vitest'
import { findMentions, linkifyMentions } from '@shared/engine/unlinked-mentions'

describe('findMentions', () => {
  it('finds a whole-word, case-insensitive mention', () => {
    const body = 'I was reading about machina yesterday.'
    const matches = findMentions(body, ['Machina'])
    expect(matches).toHaveLength(1)
    expect(body.slice(matches[0].index, matches[0].index + matches[0].length)).toBe('machina')
  })

  it('excludes occurrences already inside [[wikilinks]]', () => {
    const body = 'See [[Machina]] for details. But machina also appears here.'
    const matches = findMentions(body, ['Machina'])
    expect(matches).toHaveLength(1)
    expect(matches[0].index).toBe(body.indexOf('machina also'))
  })

  it('excludes aliased wikilinks [[target|display]]', () => {
    const matches = findMentions('Linked as [[Machina|the app]] only.', ['Machina'])
    expect(matches).toHaveLength(0)
  })

  it('excludes occurrences inside code fences', () => {
    const body = 'Before\n```\nconst x = Machina\n```\nAfter Machina mention.'
    const matches = findMentions(body, ['Machina'])
    expect(matches).toHaveLength(1)
    expect(matches[0].index).toBe(body.indexOf('Machina mention'))
  })

  it('excludes occurrences inside inline code', () => {
    const matches = findMentions('Run `machina --help` to start.', ['Machina'])
    expect(matches).toHaveLength(0)
  })

  it('respects whole-word boundaries', () => {
    const matches = findMentions('Machinations are not machinaX or Xmachina.', ['Machina'])
    expect(matches).toHaveLength(0)
  })

  it('matches titles with punctuation at non-word boundaries', () => {
    const body = 'We discussed C++ Notes earlier.'
    const matches = findMentions(body, ['C++ Notes'])
    expect(matches).toHaveLength(1)
  })

  it('excludes YAML frontmatter', () => {
    const body = '---\ntitle: Machina\n---\n\nBody mentions Machina once.'
    const matches = findMentions(body, ['Machina'])
    expect(matches).toHaveLength(1)
    expect(matches[0].index).toBe(body.lastIndexOf('Machina'))
  })

  it('excludes <node> concept tags', () => {
    const matches = findMentions('A <node>Machina</node> concept.', ['Machina'])
    expect(matches).toHaveLength(0)
  })

  it('scans multiple terms (title and id) without overlapping matches', () => {
    const body = 'The note machina-arch covers Machina.'
    const matches = findMentions(body, ['Machina', 'machina-arch'])
    expect(matches).toHaveLength(2)
    expect(body.slice(matches[0].index, matches[0].index + matches[0].length)).toBe('machina-arch')
  })

  it('ignores empty and single-character terms', () => {
    expect(findMentions('a body with a in it', ['', ' ', 'a'])).toHaveLength(0)
  })
})

describe('linkifyMentions', () => {
  it('wraps mentions in [[...]] preserving original casing', () => {
    const result = linkifyMentions('about machina and Machina.', ['Machina'])
    expect(result.count).toBe(2)
    expect(result.content).toBe('about [[machina]] and [[Machina]].')
  })

  it('leaves already-linked and code occurrences untouched', () => {
    const body = '[[Machina]] and `machina` stay; machina changes.'
    const result = linkifyMentions(body, ['Machina'])
    expect(result.count).toBe(1)
    expect(result.content).toBe('[[Machina]] and `machina` stay; [[machina]] changes.')
  })

  it('returns content unchanged when nothing matches', () => {
    const body = 'No mentions here.'
    const result = linkifyMentions(body, ['Machina'])
    expect(result.count).toBe(0)
    expect(result.content).toBe(body)
  })
})
