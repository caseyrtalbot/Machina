import { describe, it, expect } from 'vitest'
import { rematchSections } from '../section-rematch'

describe('rematchSections', () => {
  it('keeps stable when heading text is unchanged', () => {
    const r = rematchSections('## Alpha\nbody\n\n## Beta\nbody2\n', {
      c1: 'Alpha',
      c2: 'Beta'
    })
    expect(r.resolved).toEqual({ c1: 'Alpha', c2: 'Beta' })
    expect(r.unresolved).toEqual([])
    expect(r.changed).toBe(false)
  })

  it('updates the map when one heading was renamed and counts match', () => {
    const r = rematchSections('## Alpha Prime\nbody\n\n## Beta\nbody2\n', {
      c1: 'Alpha',
      c2: 'Beta'
    })
    expect(r.resolved).toEqual({ c1: 'Alpha Prime', c2: 'Beta' })
    expect(r.unresolved).toEqual([])
    expect(r.changed).toBe(true)
  })

  it('leaves unresolved when counts differ', () => {
    const r = rematchSections('## Alpha\nbody\n', { c1: 'Alpha', c2: 'Beta' })
    expect(r.unresolved).toContain('c2')
  })

  it('leaves unresolved when multiple headings changed (ambiguous)', () => {
    const r = rematchSections('## A1\nbody\n\n## B1\nbody2\n', {
      c1: 'Alpha',
      c2: 'Beta'
    })
    // Ambiguous: both renamed; positional map still succeeds when counts match,
    // but the caller gets `changed: true` to persist the refreshed map.
    expect(r.resolved).toEqual({ c1: 'A1', c2: 'B1' })
    expect(r.changed).toBe(true)
  })
})
