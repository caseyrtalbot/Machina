// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeOntologyLayout } from '@shared/engine/ontology-layout'
import { groupId, revisionId } from '@shared/engine/ontology-types'
import type { OntologySnapshot } from '@shared/engine/ontology-types'
import { GROUP_GAP_MIN } from '@shared/engine/ontology-types'

function makeSnapshot(overrides: Partial<OntologySnapshot> = {}): OntologySnapshot {
  return {
    revisionId: revisionId('test'),
    createdAt: '2026-03-31T00:00:00Z',
    rootGroupIds: [],
    groupsById: {},
    ungroupedNoteIds: [],
    auxiliaryCardIds: [],
    interGroupEdges: [],
    ...overrides
  }
}

describe('computeOntologyLayout', () => {
  it('returns empty result for empty snapshot', () => {
    const result = computeOntologyLayout(makeSnapshot(), {}, { x: 0, y: 0 })
    expect(Object.keys(result.cardPositions)).toHaveLength(0)
    expect(Object.keys(result.groupFrames)).toHaveLength(0)
  })

  it('positions cards within group frame bounds', () => {
    const g1 = groupId('g1')
    const snapshot = makeSnapshot({
      rootGroupIds: [g1],
      groupsById: {
        g1: {
          id: g1,
          label: 'Systems',
          parentGroupId: null,
          colorToken: 'ontology-green',
          cardIds: ['c1', 'c2'],
          provenance: { kind: 'user-tag', tagPaths: ['systems'] }
        }
      }
    })
    const cardSizes: Record<string, { width: number; height: number }> = {
      c1: { width: 200, height: 100 },
      c2: { width: 200, height: 100 }
    }

    const result = computeOntologyLayout(snapshot, cardSizes, { x: 0, y: 0 })

    const frame = result.groupFrames.g1
    expect(frame).toBeDefined()
    expect(frame.isRoot).toBe(true)

    // Every card position should be inside the group frame
    for (const cardId of ['c1', 'c2']) {
      const pos = result.cardPositions[cardId]
      expect(pos.x).toBeGreaterThanOrEqual(frame.x)
      expect(pos.y).toBeGreaterThanOrEqual(frame.y)
      expect(pos.x + cardSizes[cardId].width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(pos.y + cardSizes[cardId].height).toBeLessThanOrEqual(frame.y + frame.height)
    }
  })

  it('produces deterministic output', () => {
    const g1 = groupId('g1')
    const snapshot = makeSnapshot({
      rootGroupIds: [g1],
      groupsById: {
        g1: {
          id: g1,
          label: 'Test',
          parentGroupId: null,
          colorToken: 'ontology-green',
          cardIds: ['c1'],
          provenance: { kind: 'user-tag', tagPaths: ['test'] }
        }
      }
    })
    const sizes = { c1: { width: 200, height: 100 } }
    const origin = { x: 0, y: 0 }

    const r1 = computeOntologyLayout(snapshot, sizes, origin)
    const r2 = computeOntologyLayout(snapshot, sizes, origin)
    expect(r1).toEqual(r2)
  })

  it('maintains GROUP_GAP_MIN between root groups', () => {
    const g1 = groupId('g1')
    const g2 = groupId('g2')
    const snapshot = makeSnapshot({
      rootGroupIds: [g1, g2],
      groupsById: {
        g1: {
          id: g1,
          label: 'Alpha',
          parentGroupId: null,
          colorToken: 'ontology-green',
          cardIds: ['c1'],
          provenance: { kind: 'user-tag', tagPaths: ['alpha'] }
        },
        g2: {
          id: g2,
          label: 'Beta',
          parentGroupId: null,
          colorToken: 'ontology-blue',
          cardIds: ['c2'],
          provenance: { kind: 'user-tag', tagPaths: ['beta'] }
        }
      },
      interGroupEdges: []
    })
    const sizes = {
      c1: { width: 200, height: 100 },
      c2: { width: 200, height: 100 }
    }

    const result = computeOntologyLayout(snapshot, sizes, { x: 0, y: 0 })

    const f1 = result.groupFrames.g1
    const f2 = result.groupFrames.g2
    // Check horizontal or vertical gap >= GROUP_GAP_MIN
    const hGap = Math.max(0, f2.x - (f1.x + f1.width), f1.x - (f2.x + f2.width))
    const vGap = Math.max(0, f2.y - (f1.y + f1.height), f1.y - (f2.y + f2.height))
    expect(Math.max(hGap, vGap)).toBeGreaterThanOrEqual(GROUP_GAP_MIN)
  })

  it('sorts groups alphabetically when all weights are zero', () => {
    const g1 = groupId('g1')
    const g2 = groupId('g2')
    const snapshot = makeSnapshot({
      rootGroupIds: [g1, g2],
      groupsById: {
        g1: {
          id: g1,
          label: 'Zebra',
          parentGroupId: null,
          colorToken: 'ontology-green',
          cardIds: ['c1'],
          provenance: { kind: 'user-tag', tagPaths: ['zebra'] }
        },
        g2: {
          id: g2,
          label: 'Alpha',
          parentGroupId: null,
          colorToken: 'ontology-blue',
          cardIds: ['c2'],
          provenance: { kind: 'user-tag', tagPaths: ['alpha'] }
        }
      }
    })
    const sizes = { c1: { width: 200, height: 100 }, c2: { width: 200, height: 100 } }

    const result = computeOntologyLayout(snapshot, sizes, { x: 0, y: 0 })

    // Alpha should be the anchor (placed at origin area)
    const alphaFrame = result.groupFrames.g2
    const zebraFrame = result.groupFrames.g1
    // Alpha should be at or near origin, Zebra offset
    expect(alphaFrame.x).toBeLessThanOrEqual(zebraFrame.x)
  })
})
