import { describe, it, expect } from 'vitest'
import {
  buildAdjacencyList,
  computeConnectedSet,
  easeOut,
  interpolateGlow
} from '../../src/renderer/src/panels/graph/useGraphHighlight'
import type { SimEdge } from '../../src/renderer/src/panels/graph/GraphRenderer'

// ---------------------------------------------------------------------------
// buildAdjacencyList
// ---------------------------------------------------------------------------

describe('buildAdjacencyList', () => {
  it('builds bidirectional adjacency from edges with string IDs', () => {
    const edges: SimEdge[] = [{ source: 'a', target: 'b', kind: 'connection' }]
    const adjacency = buildAdjacencyList(edges)

    expect(adjacency.get('a')).toEqual(new Set(['b']))
    expect(adjacency.get('b')).toEqual(new Set(['a']))
  })

  it('handles edges where source/target are SimNode objects', () => {
    const edges: SimEdge[] = [
      {
        source: {
          id: 'a',
          title: 'A',
          type: 'note',
          signal: 'active',
          connectionCount: 1,
          x: 0,
          y: 0
        },
        target: {
          id: 'b',
          title: 'B',
          type: 'note',
          signal: 'active',
          connectionCount: 1,
          x: 0,
          y: 0
        },
        kind: 'connection'
      }
    ]
    const adjacency = buildAdjacencyList(edges)

    expect(adjacency.get('a')).toEqual(new Set(['b']))
    expect(adjacency.get('b')).toEqual(new Set(['a']))
  })

  it('returns empty map for no edges', () => {
    const adjacency = buildAdjacencyList([])
    expect(adjacency.size).toBe(0)
  })

  it('handles multiple edges accumulating neighbors correctly', () => {
    const edges: SimEdge[] = [
      { source: 'a', target: 'b', kind: 'connection' },
      { source: 'a', target: 'c', kind: 'cluster' }
    ]
    const adjacency = buildAdjacencyList(edges)

    expect(adjacency.get('a')).toEqual(new Set(['b', 'c']))
    expect(adjacency.get('b')).toEqual(new Set(['a']))
    expect(adjacency.get('c')).toEqual(new Set(['a']))
  })
})

// ---------------------------------------------------------------------------
// computeConnectedSet
// ---------------------------------------------------------------------------

describe('computeConnectedSet', () => {
  it('returns the node itself and its immediate neighbors', () => {
    const adjacency: Map<string, ReadonlySet<string>> = new Map([
      ['a', new Set(['b', 'c'])],
      ['b', new Set(['a'])],
      ['c', new Set(['a'])]
    ])
    const result = computeConnectedSet('a', adjacency)

    expect(result.has('a')).toBe(true)
    expect(result.has('b')).toBe(true)
    expect(result.has('c')).toBe(true)
    expect(result.size).toBe(3)
  })

  it('returns singleton set for a node with no neighbors', () => {
    const adjacency: Map<string, ReadonlySet<string>> = new Map([['a', new Set<string>()]])
    const result = computeConnectedSet('a', adjacency)

    expect(result.has('a')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('returns singleton set for a node not present in adjacency', () => {
    const adjacency: Map<string, ReadonlySet<string>> = new Map()
    const result = computeConnectedSet('x', adjacency)

    expect(result.has('x')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('returns correct set for isolated cluster, not transitive neighbors', () => {
    // a -> b -> c, but computeConnectedSet('a') should only return a and b, not c
    const adjacency: Map<string, ReadonlySet<string>> = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a', 'c'])],
      ['c', new Set(['b'])]
    ])
    const result = computeConnectedSet('a', adjacency)

    expect(result.has('a')).toBe(true)
    expect(result.has('b')).toBe(true)
    expect(result.has('c')).toBe(false)
    expect(result.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// easeOut
// ---------------------------------------------------------------------------

describe('easeOut', () => {
  it('returns 0 at t=0', () => {
    expect(easeOut(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeOut(1)).toBe(1)
  })

  it('returns values between 0 and 1 for intermediate t', () => {
    const mid = easeOut(0.5)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('decelerates (second half covers less distance than first)', () => {
    // easeOut should have the bulk of change in the first half
    // so easeOut(0.5) > 0.5
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })
})

// ---------------------------------------------------------------------------
// interpolateGlow
// ---------------------------------------------------------------------------

describe('interpolateGlow', () => {
  it('returns startValue at elapsed=0 for fade-out', () => {
    const now = 1000
    const { value } = interpolateGlow(1, 0, now, now)
    expect(value).toBe(1)
  })

  it('fade-in is instant (0ms duration)', () => {
    const startTime = 1000
    // With GLOW_FADE_IN_MS=0, any elapsed time completes the animation
    const { value, done } = interpolateGlow(0, 1, startTime, startTime)
    expect(value).toBe(1)
    expect(done).toBe(true)
  })

  it('returns target when fully elapsed (fade-out, 150ms)', () => {
    const startTime = 1000
    const elapsed150 = startTime + 150
    const { value, done } = interpolateGlow(1, 0, startTime, elapsed150)
    expect(value).toBe(0)
    expect(done).toBe(true)
  })

  it('interpolates partially for mid-transition (fade-out)', () => {
    const startTime = 0
    const halfTime = 75 // half of GLOW_FADE_OUT_MS (150)
    const { value, done } = interpolateGlow(1, 0, startTime, halfTime)
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(1)
    expect(done).toBe(false)
  })

  it('fade-out is not done before duration completes', () => {
    const startTime = 0
    const { done } = interpolateGlow(1, 0, startTime, 50)
    expect(done).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fade state persistence
// ---------------------------------------------------------------------------

describe('fade state persistence', () => {
  it('interpolateGlow returns intermediate values during fade-out', () => {
    const result = interpolateGlow(1, 0, 0, 75) // halfway through 150ms
    expect(result.value).toBeGreaterThan(0)
    expect(result.value).toBeLessThan(1)
    expect(result.done).toBe(false)
  })

  it('interpolateGlow completes at full duration', () => {
    const result = interpolateGlow(1, 0, 0, 150)
    expect(result.value).toBe(0)
    expect(result.done).toBe(true)
  })

  it('easeOut produces smooth curve values', () => {
    // At t=0.5: 1 - (1-0.5)^2 = 1 - 0.25 = 0.75
    expect(easeOut(0.5)).toBe(0.75)
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
  })
})
