import { describe, it, expect } from 'vitest'
import { mergeSemanticHits, type SearchHit } from '@shared/engine/search-engine'

const hit = (id: string, score = 1): SearchHit => ({
  id,
  title: id,
  path: `/v/${id}.md`,
  snippet: '',
  score
})

describe('mergeSemanticHits', () => {
  it('appends semantic hits after lexical, marked semantic, when under the limit', () => {
    const merged = mergeSemanticHits([hit('a'), hit('b')], [hit('c'), hit('d')], 10)
    expect(merged.map((h) => h.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(merged.map((h) => h.semantic === true)).toEqual([false, false, true, true])
  })

  it('drops semantic hits whose id already appears in the lexical list', () => {
    const merged = mergeSemanticHits([hit('a'), hit('b')], [hit('b'), hit('c')], 10)
    expect(merged.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    // The lexical occurrence wins: it stays unmarked.
    expect(merged[1].semantic).toBeUndefined()
  })

  it('reserves up to 3 slots for semantic hits when both lists overflow the limit', () => {
    const lexical = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'].map((id) => hit(id))
    const semantic = ['s1', 's2', 's3', 's4', 's5'].map((id) => hit(id))
    const merged = mergeSemanticHits(lexical, semantic, 8)
    expect(merged.map((h) => h.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 's1', 's2', 's3'])
  })

  it('gives unused lexical slots to semantic hits', () => {
    const merged = mergeSemanticHits(
      [hit('l1'), hit('l2')],
      ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((id) => hit(id)),
      8
    )
    expect(merged.map((h) => h.id)).toEqual(['l1', 'l2', 's1', 's2', 's3', 's4', 's5', 's6'])
  })

  it('preserves lexical ordering and returns [] for limit <= 0', () => {
    expect(mergeSemanticHits([hit('a')], [hit('b')], 0)).toEqual([])
    const merged = mergeSemanticHits([hit('b', 2), hit('a', 1)], [], 5)
    expect(merged.map((h) => h.id)).toEqual(['b', 'a'])
  })
})
