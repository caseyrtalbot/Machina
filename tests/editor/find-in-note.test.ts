import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import {
  findMatches,
  buildDecorationSpecs
} from '../../src/renderer/src/panels/editor/extensions/find-in-note'

// Minimal schema: paragraphs, text with a bold mark, and an inline atom
// (stand-in for wikilink-style leaf nodes that occupy positions).
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    atom: { group: 'inline', inline: true, atom: true }
  },
  marks: { bold: {} }
})

const p = (...content: Parameters<typeof schema.node>[2][]) =>
  schema.node('paragraph', null, content.flat() as never)
const doc = (...paragraphs: ReturnType<typeof p>[]) => schema.node('doc', null, paragraphs)
const text = (s: string) => schema.text(s)
const bold = (s: string) => schema.text(s, [schema.mark('bold')])

describe('findMatches', () => {
  it('returns empty for an empty query', () => {
    expect(findMatches(doc(p(text('hello'))), '')).toEqual([])
  })

  it('returns empty when nothing matches', () => {
    expect(findMatches(doc(p(text('hello world'))), 'zebra')).toEqual([])
  })

  it('finds a match with correct document positions', () => {
    // doc(1-based content): paragraph opens at 0, text starts at pos 1
    const matches = findMatches(doc(p(text('hello world'))), 'world')
    expect(matches).toEqual([{ from: 7, to: 12 }])
  })

  it('is case-insensitive in both directions', () => {
    const d = doc(p(text('Hello HELLO hello')))
    expect(findMatches(d, 'hello')).toHaveLength(3)
    expect(findMatches(d, 'HeLLo')).toHaveLength(3)
  })

  it('finds matches across multiple paragraphs with paragraph-aware offsets', () => {
    // First paragraph: positions 1..4 ("abc"), second paragraph starts at 5,
    // its text at position 6.
    const matches = findMatches(doc(p(text('abc')), p(text('abc'))), 'abc')
    expect(matches).toEqual([
      { from: 1, to: 4 },
      { from: 6, to: 9 }
    ])
  })

  it('finds a match spanning a mark boundary (split text nodes)', () => {
    const matches = findMatches(doc(p(text('he'), bold('llo'))), 'hello')
    expect(matches).toEqual([{ from: 1, to: 6 }])
  })

  it('keeps offsets aligned past inline atom nodes', () => {
    // "ab" (pos 1-2), atom (pos 3), "cd" (pos 4-5)
    const matches = findMatches(doc(p(text('ab'), schema.node('atom'), text('cd'))), 'cd')
    expect(matches).toEqual([{ from: 4, to: 6 }])
  })

  it('does not match across the atom placeholder', () => {
    expect(findMatches(doc(p(text('ab'), schema.node('atom'), text('cd'))), 'abcd')).toEqual([])
  })

  it('returns non-overlapping matches', () => {
    // "aaa" with query "aa" → one match, not two overlapping
    expect(findMatches(doc(p(text('aaa'))), 'aa')).toEqual([{ from: 1, to: 3 }])
  })
})

describe('buildDecorationSpecs', () => {
  const matches = [
    { from: 1, to: 4 },
    { from: 6, to: 9 },
    { from: 11, to: 14 }
  ]

  it('flags exactly the active match', () => {
    const specs = buildDecorationSpecs(matches, 1)
    expect(specs).toEqual([
      { from: 1, to: 4, active: false },
      { from: 6, to: 9, active: true },
      { from: 11, to: 14, active: false }
    ])
  })

  it('preserves match order and count', () => {
    const specs = buildDecorationSpecs(matches, 0)
    expect(specs.map((s) => s.from)).toEqual([1, 6, 11])
    expect(specs.filter((s) => s.active)).toHaveLength(1)
  })

  it('returns no active flag when activeIndex is out of range', () => {
    const specs = buildDecorationSpecs(matches, 5)
    expect(specs.every((s) => !s.active)).toBe(true)
  })

  it('handles empty matches', () => {
    expect(buildDecorationSpecs([], 0)).toEqual([])
  })
})
