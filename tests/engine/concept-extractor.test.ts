import { describe, it, expect } from 'vitest'
import { extractConceptNodes } from '@engine/concept-extractor'

describe('extractConceptNodes', () => {
  it('extracts simple concept nodes', () => {
    expect(extractConceptNodes('See <node>Category Creation</node> for details.')).toEqual([
      'Category Creation'
    ])
  })

  it('extracts multiple concept nodes on one line', () => {
    expect(extractConceptNodes('Both <node>Alpha</node> and <node>Beta</node> apply.')).toEqual([
      'Alpha',
      'Beta'
    ])
  })

  it('extracts concept nodes across multiple lines', () => {
    const body = `First <node>Note A</node> here.
Second paragraph with <node>Note B</node>.
And <node>Note C</node> too.`
    expect(extractConceptNodes(body)).toEqual(['Note A', 'Note B', 'Note C'])
  })

  it('deduplicates by case-insensitive comparison', () => {
    expect(
      extractConceptNodes('<node>Alpha</node> and <node>alpha</node> and <node>ALPHA</node>')
    ).toEqual(['Alpha'])
  })

  it('returns empty array for body without concept nodes', () => {
    expect(extractConceptNodes('No links here, just plain text.')).toEqual([])
  })

  it('returns empty array for empty body', () => {
    expect(extractConceptNodes('')).toEqual([])
  })

  it('handles special characters in terms', () => {
    expect(
      extractConceptNodes("See <node>C++ Patterns</node> and <node>O'Brien Notes</node>")
    ).toEqual(['C++ Patterns', "O'Brien Notes"])
  })

  it('ignores concept nodes with empty terms', () => {
    expect(extractConceptNodes('Empty <node></node> should be skipped.')).toEqual([])
  })

  it('ignores concept nodes with whitespace-only terms', () => {
    expect(extractConceptNodes('Blank <node>   </node> should be skipped.')).toEqual([])
  })

  it('preserves first-seen casing for duplicates', () => {
    const result = extractConceptNodes(
      '<node>Feedback Loops</node> then <node>feedback loops</node>'
    )
    expect(result).toEqual(['Feedback Loops'])
    expect(result).toHaveLength(1)
  })

  it('trims whitespace from terms', () => {
    expect(extractConceptNodes('<node> strategy </node>')).toEqual(['strategy'])
  })
})
