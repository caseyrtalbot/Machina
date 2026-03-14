import { describe, it, expect } from 'vitest'
import { extractWikilinks } from '@engine/wikilink-extractor'

describe('extractWikilinks', () => {
  it('extracts simple wikilinks', () => {
    expect(extractWikilinks('See [[Category Creation]] for details.')).toEqual([
      'Category Creation'
    ])
  })

  it('extracts piped wikilinks (target|display)', () => {
    expect(extractWikilinks('Read [[OODA Loop|Boyd cycle]] theory.')).toEqual(['OODA Loop'])
  })

  it('extracts multiple wikilinks on one line', () => {
    expect(extractWikilinks('Both [[Alpha]] and [[Beta]] apply.')).toEqual(['Alpha', 'Beta'])
  })

  it('extracts wikilinks across multiple lines', () => {
    const body = `First [[Note A]] here.
Second paragraph with [[Note B]].
And [[Note C|display]] too.`
    expect(extractWikilinks(body)).toEqual(['Note A', 'Note B', 'Note C'])
  })

  it('deduplicates by case-insensitive comparison', () => {
    expect(extractWikilinks('[[Alpha]] and [[alpha]] and [[ALPHA]]')).toEqual(['Alpha'])
  })

  it('returns empty array for body without wikilinks', () => {
    expect(extractWikilinks('No links here, just plain text.')).toEqual([])
  })

  it('returns empty array for empty body', () => {
    expect(extractWikilinks('')).toEqual([])
  })

  it('handles special characters in targets', () => {
    expect(extractWikilinks('See [[C++ Patterns]] and [[O\'Brien Notes]]')).toEqual([
      "C++ Patterns",
      "O'Brien Notes"
    ])
  })

  it('ignores wikilinks with empty targets', () => {
    expect(extractWikilinks('Empty [[]] should be skipped.')).toEqual([])
  })

  it('handles wikilinks with whitespace-only pipe display', () => {
    expect(extractWikilinks('Link [[Target|  ]] with blank display.')).toEqual(['Target'])
  })

  it('preserves first-seen casing for duplicates', () => {
    const result = extractWikilinks('[[Feedback Loops]] then [[feedback loops]]')
    expect(result).toEqual(['Feedback Loops'])
    expect(result).toHaveLength(1)
  })
})
