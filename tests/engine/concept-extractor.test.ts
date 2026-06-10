import { describe, it, expect } from 'vitest'
import { extractConceptNodes, stripCode } from '@engine/concept-extractor'

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

  it('ignores concept nodes inside fenced code blocks', () => {
    const body = `Real <node>Alpha</node> here.

\`\`\`html
Fenced <node>Fake</node> markup.
\`\`\``
    expect(extractConceptNodes(body)).toEqual(['Alpha'])
  })

  it('ignores concept nodes inside inline code spans', () => {
    expect(extractConceptNodes('Use `<node>Fake</node>` syntax for <node>Real</node>.')).toEqual([
      'Real'
    ])
  })
})

describe('stripCode', () => {
  it('removes fenced code blocks', () => {
    const body = 'before\n```ts\nconst x = "[[fake]]"\n```\nafter'
    const stripped = stripCode(body)
    expect(stripped).not.toContain('[[fake]]')
    expect(stripped).toContain('before')
    expect(stripped).toContain('after')
  })

  it('removes tilde-fenced blocks', () => {
    const body = 'before\n~~~\n[[fake]]\n~~~\nafter'
    expect(stripCode(body)).not.toContain('[[fake]]')
  })

  it('removes inline code spans but keeps surrounding prose', () => {
    expect(stripCode('keep `drop [[this]]` keep too')).toBe('keep  keep too')
  })

  it('treats an unclosed fence as running to the end', () => {
    const body = 'prose\n```\n[[fake]]\nstill code'
    const stripped = stripCode(body)
    expect(stripped).toContain('prose')
    expect(stripped).not.toContain('[[fake]]')
    expect(stripped).not.toContain('still code')
  })

  it('does not pair backtick and tilde fences with each other', () => {
    const body = '```\n~~~ not a closer\n[[fake]]\n```\nafter'
    const stripped = stripCode(body)
    expect(stripped).not.toContain('[[fake]]')
    expect(stripped).toContain('after')
  })
})
