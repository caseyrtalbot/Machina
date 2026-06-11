import { describe, it, expect } from 'vitest'
import type { Artifact } from '@shared/types'
import {
  filterWikilinkSuggestions,
  MAX_WIKILINK_SUGGESTIONS
} from '../../src/renderer/src/panels/editor/extensions/wikilink-suggestion-filter'

function makeArtifact(id: string, title: string, modified?: string): Artifact {
  return {
    id,
    title,
    type: 'note',
    modified,
    signal: 'emerging',
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
    frontmatter: {}
  }
}

describe('filterWikilinkSuggestions', () => {
  it('ranks title prefix matches above substring matches', () => {
    const artifacts = [makeArtifact('n-1', 'Notes on Graphs'), makeArtifact('n-2', 'Graph Theory')]
    const result = filterWikilinkSuggestions(artifacts, 'graph')
    expect(result.map((a) => a.title)).toEqual(['Graph Theory', 'Notes on Graphs'])
  })

  it('matches case-insensitively on title', () => {
    const artifacts = [makeArtifact('n-1', 'Richard Hamming')]
    expect(filterWikilinkSuggestions(artifacts, 'richard')).toHaveLength(1)
    expect(filterWikilinkSuggestions(artifacts, 'HAMMING')).toHaveLength(1)
  })

  it('matches on id when title does not match', () => {
    const artifacts = [makeArtifact('hamming-essay', 'You and Your Research')]
    const result = filterWikilinkSuggestions(artifacts, 'hamming')
    expect(result.map((a) => a.id)).toEqual(['hamming-essay'])
  })

  it('excludes non-matching artifacts for non-empty queries', () => {
    const artifacts = [makeArtifact('n-1', 'Alpha'), makeArtifact('n-2', 'Beta')]
    const result = filterWikilinkSuggestions(artifacts, 'alpha')
    expect(result.map((a) => a.title)).toEqual(['Alpha'])
  })

  it('returns most recently modified artifacts for an empty query', () => {
    const artifacts = [
      makeArtifact('n-old', 'Old', '2026-01-01'),
      makeArtifact('n-new', 'New', '2026-06-01'),
      makeArtifact('n-mid', 'Mid', '2026-03-01')
    ]
    const result = filterWikilinkSuggestions(artifacts, '')
    expect(result.map((a) => a.id)).toEqual(['n-new', 'n-mid', 'n-old'])
  })

  it('tiebreaks equal scores by modified desc', () => {
    const artifacts = [
      makeArtifact('n-stale', 'Graph A', '2026-01-01'),
      makeArtifact('n-fresh', 'Graph B', '2026-06-01')
    ]
    const result = filterWikilinkSuggestions(artifacts, 'graph')
    expect(result.map((a) => a.id)).toEqual(['n-fresh', 'n-stale'])
  })

  it('sorts artifacts without a modified date after dated ones', () => {
    const artifacts = [
      makeArtifact('n-undated', 'Graph A'),
      makeArtifact('n-dated', 'Graph B', '2026-06-01')
    ]
    const result = filterWikilinkSuggestions(artifacts, 'graph')
    expect(result.map((a) => a.id)).toEqual(['n-dated', 'n-undated'])
  })

  it('caps results at MAX_WIKILINK_SUGGESTIONS', () => {
    const artifacts = Array.from({ length: 20 }, (_, i) =>
      makeArtifact(`n-${i}`, `Graph ${i}`, `2026-05-${String(i + 1).padStart(2, '0')}`)
    )
    expect(filterWikilinkSuggestions(artifacts, 'graph')).toHaveLength(MAX_WIKILINK_SUGGESTIONS)
    expect(filterWikilinkSuggestions(artifacts, '')).toHaveLength(MAX_WIKILINK_SUGGESTIONS)
  })

  it('respects a custom max', () => {
    const artifacts = Array.from({ length: 5 }, (_, i) => makeArtifact(`n-${i}`, `Graph ${i}`))
    expect(filterWikilinkSuggestions(artifacts, 'graph', 2)).toHaveLength(2)
  })

  it('returns empty for empty vault', () => {
    expect(filterWikilinkSuggestions([], 'anything')).toEqual([])
    expect(filterWikilinkSuggestions([], '')).toEqual([])
  })
})
