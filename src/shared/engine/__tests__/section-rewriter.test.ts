import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  extractSection,
  replaceSection,
  addSection,
  removeSection,
  reorderSections
} from '../section-rewriter'

const MAP = { c1: 'Alpha', c2: 'Beta', c3: 'Gamma' }

const FILE = [
  'intro paragraph',
  '',
  '## Alpha',
  'alpha body line 1',
  'alpha body line 2',
  '',
  '## Beta',
  'beta body',
  '',
  '## Gamma',
  'gamma body'
].join('\n')

describe('extractSection', () => {
  it('returns the body of a section without the heading', () => {
    const r = extractSection(FILE, 'c2', MAP)
    expect(r).toEqual({ ok: true, value: 'beta body\n' })
  })

  it('returns an error result when the heading is missing', () => {
    const r = extractSection(FILE, 'c1', { c1: 'Not Here' })
    expect(r).toEqual({ ok: false, error: 'section-not-found' })
  })
})

describe('replaceSection', () => {
  it('replaces only the target section span', () => {
    const r = replaceSection(FILE, 'c2', 'new beta\n', MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toContain('## Alpha\nalpha body line 1')
    expect(r.value).toContain('## Beta\nnew beta\n\n## Gamma')
    expect(r.value).toContain('intro paragraph')
  })

  it('is idempotent when body is unchanged', () => {
    const r = replaceSection(FILE, 'c2', 'beta body\n', MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe(FILE)
  })
})

describe('addSection', () => {
  it('appends a new section at end and returns updated map', () => {
    const r = addSection(FILE, { cardId: 'c4', heading: 'Delta', body: 'delta body' }, 'end', MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.content).toMatch(/## Delta\ndelta body\n?$/)
    expect(r.value.sectionMap).toEqual({ ...MAP, c4: 'Delta' })
  })

  it('de-duplicates heading collisions', () => {
    const r = addSection(FILE, { cardId: 'c4', heading: 'Alpha', body: 'x' }, 'end', MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.sectionMap.c4).toBe('Alpha (2)')
    expect(r.value.content).toContain('## Alpha (2)')
  })
})

describe('removeSection', () => {
  it('removes a section and returns updated map', () => {
    const r = removeSection(FILE, 'c2', MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.content).not.toContain('## Beta')
    expect(r.value.content).toContain('## Alpha')
    expect(r.value.content).toContain('## Gamma')
    expect(r.value.sectionMap).toEqual({ c1: 'Alpha', c3: 'Gamma' })
  })
})

describe('reorderSections', () => {
  it('reorders sections to the given order', () => {
    const r = reorderSections(FILE, ['c3', 'c1', 'c2'], MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const gammaAt = r.value.indexOf('## Gamma')
    const alphaAt = r.value.indexOf('## Alpha')
    const betaAt = r.value.indexOf('## Beta')
    expect(gammaAt).toBeGreaterThan(0)
    expect(gammaAt).toBeLessThan(alphaAt)
    expect(alphaAt).toBeLessThan(betaAt)
  })

  it('preserves the intro (prelude before first heading)', () => {
    const r = reorderSections(FILE, ['c3', 'c1', 'c2'], MAP)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.startsWith('intro paragraph')).toBe(true)
  })
})

describe('section-rewriter properties', () => {
  const sectionArb = fc
    .tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 40 }))
    .map(([heading, body]) => {
      const h = heading.replace(/[\n#\s]+/g, '_').replace(/^_+|_+$/g, '')
      return {
        heading: h || 'h',
        body: body.replace(/\n#/g, 'x')
      }
    })

  const fileArb = fc.array(sectionArb, { minLength: 2, maxLength: 6 }).map((secs) => {
    const seen = new Set<string>()
    const unique = secs.map((s, i) => {
      let h = s.heading
      let n = 2
      while (seen.has(h)) h = `${s.heading} (${n++})`
      seen.add(h)
      return { ...s, heading: h, cardId: `c${i}` }
    })
    const map: Record<string, string> = {}
    for (const s of unique) map[s.cardId] = s.heading
    const content = 'intro\n\n' + unique.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n')
    return { content, map, sections: unique }
  })

  it('replaceSection with equal body is byte-identical', () => {
    fc.assert(
      fc.property(fileArb, ({ content, map, sections }) => {
        for (const s of sections) {
          const body = extractSection(content, s.cardId, map)
          if (!body.ok) throw new Error('extract failed')
          const r = replaceSection(content, s.cardId, body.value, map)
          if (!r.ok) throw new Error('replace failed')
          if (r.value !== content) throw new Error(`replace not idempotent for ${s.cardId}`)
        }
      }),
      { numRuns: 100 }
    )
  })

  it('reorderSections preserves all sections', () => {
    fc.assert(
      fc.property(fileArb, ({ content, map, sections }) => {
        const order = [...sections.map((s) => s.cardId)].reverse()
        const r = reorderSections(content, order, map)
        if (!r.ok) throw new Error('reorder failed')
        for (const s of sections) {
          if (!r.value.includes(`## ${s.heading}`)) throw new Error(`lost heading ${s.heading}`)
        }
      }),
      { numRuns: 100 }
    )
  })
})
