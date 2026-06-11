import { describe, it, expect } from 'vitest'
import { TE_DIR } from '@shared/constants'
import type { Artifact } from '@shared/types'
import {
  MAX_ENRICHMENT_TARGETS,
  buildEnrichmentPrompt,
  isUnconnected,
  selectEnrichmentTargets
} from '@renderer/panels/graph/enrichment-targets'

function makeArtifact(overrides: Partial<Artifact> & { id: string }): Artifact {
  return {
    title: overrides.id,
    type: 'note',
    signal: 'untested',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    concepts: [],
    origin: 'human',
    sources: [],
    bodyLinks: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

const VAULT = '/Users/me/vault'

describe('isUnconnected', () => {
  it('is true for an artifact with no tags, relationships, or body links', () => {
    expect(isUnconnected(makeArtifact({ id: 'bare' }))).toBe(true)
  })

  it.each([
    ['tags', { tags: ['idea'] }],
    ['connections', { connections: ['Other'] }],
    ['clusters_with', { clusters_with: ['Other'] }],
    ['tensions_with', { tensions_with: ['Other'] }],
    ['related', { related: ['Other'] }],
    ['appears_in', { appears_in: ['Other'] }],
    ['bodyLinks', { bodyLinks: ['Other'] }]
  ] as const)('is false when %s is non-empty', (_label, overrides) => {
    expect(isUnconnected(makeArtifact({ id: 'x', ...overrides }))).toBe(false)
  })
})

describe('selectEnrichmentTargets', () => {
  it('selects only unconnected artifacts and relativizes their paths', () => {
    const artifacts = [
      makeArtifact({ id: 'bare', title: 'Bare Note' }),
      makeArtifact({ id: 'tagged', tags: ['done'] }),
      makeArtifact({ id: 'linked', bodyLinks: ['Bare Note'] })
    ]
    const pathById = {
      bare: `${VAULT}/ideas/bare.md`,
      tagged: `${VAULT}/tagged.md`,
      linked: `${VAULT}/linked.md`
    }
    const targets = selectEnrichmentTargets(artifacts, pathById, VAULT)
    expect(targets).toEqual([{ id: 'bare', title: 'Bare Note', path: 'ideas/bare.md' }])
  })

  it('handles a vault path with a trailing slash', () => {
    const targets = selectEnrichmentTargets(
      [makeArtifact({ id: 'a' })],
      { a: `${VAULT}/a.md` },
      `${VAULT}/`
    )
    expect(targets).toEqual([{ id: 'a', title: 'a', path: 'a.md' }])
  })

  it('drops artifacts with no known path or a path outside the vault', () => {
    const artifacts = [makeArtifact({ id: 'nopath' }), makeArtifact({ id: 'outside' })]
    const targets = selectEnrichmentTargets(artifacts, { outside: '/elsewhere/o.md' }, VAULT)
    expect(targets).toEqual([])
  })

  it(`excludes app-internal files under ${TE_DIR}/`, () => {
    const artifacts = [makeArtifact({ id: 'sys' }), makeArtifact({ id: 'note' })]
    const pathById = {
      sys: `${VAULT}/${TE_DIR}/artifacts/sessions/s1.md`,
      note: `${VAULT}/note.md`
    }
    const targets = selectEnrichmentTargets(artifacts, pathById, VAULT)
    expect(targets.map((t) => t.id)).toEqual(['note'])
  })

  it('sorts candidates by path for deterministic batches', () => {
    const artifacts = [
      makeArtifact({ id: 'z' }),
      makeArtifact({ id: 'a' }),
      makeArtifact({ id: 'm' })
    ]
    const pathById = {
      z: `${VAULT}/z.md`,
      a: `${VAULT}/a.md`,
      m: `${VAULT}/m.md`
    }
    const targets = selectEnrichmentTargets(artifacts, pathById, VAULT)
    expect(targets.map((t) => t.path)).toEqual(['a.md', 'm.md', 'z.md'])
  })

  it('returns every candidate — callers cap to MAX_ENRICHMENT_TARGETS per run', () => {
    const artifacts = Array.from({ length: MAX_ENRICHMENT_TARGETS + 3 }, (_, i) =>
      makeArtifact({ id: `n${i}` })
    )
    const pathById = Object.fromEntries(artifacts.map((a) => [a.id, `${VAULT}/${a.id}.md`]))
    const targets = selectEnrichmentTargets(artifacts, pathById, VAULT)
    expect(targets).toHaveLength(MAX_ENRICHMENT_TARGETS + 3)
  })
})

describe('buildEnrichmentPrompt', () => {
  it('lists every target path and instructs read-before-write', () => {
    const prompt = buildEnrichmentPrompt([
      { id: 'a', title: 'Alpha', path: 'ideas/alpha.md' },
      { id: 'b', title: 'Beta', path: 'beta.md' }
    ])
    expect(prompt).toContain('- ideas/alpha.md ("Alpha")')
    expect(prompt).toContain('- beta.md ("Beta")')
    expect(prompt).toMatch(/read it first/i)
    expect(prompt).toContain('edit_note')
    expect(prompt).toMatch(/skip a note rather than inventing/i)
  })

  it('instructs batched parallel tool rounds so the batch fits the 8-round budget', () => {
    const prompt = buildEnrichmentPrompt([{ id: 'a', title: 'Alpha', path: 'a.md' }])
    expect(prompt).toMatch(/hard budget of 8 tool rounds/i)
    expect(prompt).toMatch(/batch your tool calls/i)
    expect(prompt).toMatch(/ALL listed notes together in one parallel block/)
  })
})
