// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeOntologySnapshot } from '@shared/engine/ontology-grouping'
import { computeOntologyLayout } from '@shared/engine/ontology-layout'

// --- Test fixtures ---

interface TestCard {
  readonly id: string
  readonly type: 'note' | 'text' | 'code'
  readonly content: string
}

interface TestArtifact {
  readonly id: string
  readonly tags: readonly string[]
  readonly bodyLinks: readonly string[]
  readonly connections: readonly string[]
  readonly concepts: readonly string[]
  readonly title: string
}

function makeCard(id: string, type: 'note' | 'text' | 'code' = 'note', content = ''): TestCard {
  return { id, type, content: content || `/vault/${id}.md` }
}

function makeArtifact(
  id: string,
  tags: string[] = [],
  opts: Partial<TestArtifact> = {}
): TestArtifact {
  return {
    id,
    tags,
    bodyLinks: opts.bodyLinks ?? [],
    connections: opts.connections ?? [],
    concepts: opts.concepts ?? [],
    title: opts.title ?? id
  }
}

describe('computeOntologySnapshot', () => {
  describe('Step 1: card resolution', () => {
    it('non-note cards go into auxiliaryCardIds', () => {
      const cards = [makeCard('c1', 'text'), makeCard('c2', 'code')]
      const result = computeOntologySnapshot({
        cards,
        fileToId: {},
        artifacts: {},
        graphEdges: []
      })
      expect(result.auxiliaryCardIds).toEqual(['c1', 'c2'])
      expect(result.ungroupedNoteIds).toEqual([])
      expect(result.rootGroupIds).toEqual([])
    })

    it('note cards with no artifact match go into ungroupedNoteIds', () => {
      const cards = [makeCard('c1', 'note')]
      const result = computeOntologySnapshot({
        cards,
        fileToId: {},
        artifacts: {},
        graphEdges: []
      })
      expect(result.ungroupedNoteIds).toEqual(['c1'])
    })
  })

  describe('Step 2: primary tag grouping', () => {
    it('groups cards by top-level tag', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', ['systems']),
        a3: makeArtifact('a3', ['models'])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      expect(result.rootGroupIds).toHaveLength(2)
      const groups = Object.values(result.groupsById)
      const systemsGroup = groups.find((g) => g.label === 'systems')!
      const modelsGroup = groups.find((g) => g.label === 'models')!
      expect(systemsGroup.cardIds).toEqual(['c1', 'c2'])
      expect(modelsGroup.cardIds).toEqual(['c3'])
    })

    it('untagged notes go to ungroupedNoteIds', () => {
      const cards = [makeCard('c1'), makeCard('c2')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', [])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      expect(result.ungroupedNoteIds).toEqual(['c2'])
    })

    it('multi-tag cards assigned to highest-scoring tag', () => {
      // c1 has tags [alpha, beta]. c2 and c3 have tag [beta].
      // beta has frequency 3 vs alpha frequency 1, so c1 should go to beta.
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['alpha', 'beta']),
        a2: makeArtifact('a2', ['beta']),
        a3: makeArtifact('a3', ['beta'])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      const betaGroup = Object.values(result.groupsById).find((g) => g.label === 'beta')!
      expect(betaGroup.cardIds).toContain('c1')
    })
  })

  describe('Step 3: sub-grouping by nested tags', () => {
    it('creates child groups from second-level tags', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems/feedback']),
        a2: makeArtifact('a2', ['systems/emergence']),
        a3: makeArtifact('a3', ['systems'])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      const rootGroup = Object.values(result.groupsById).find(
        (g) => g.label === 'systems' && g.parentGroupId === null
      )!
      expect(rootGroup).toBeDefined()
      // c3 stays in root (no sub-tag)
      expect(rootGroup.cardIds).toContain('c3')

      const childGroups = Object.values(result.groupsById).filter(
        (g) => g.parentGroupId === rootGroup.id
      )
      expect(childGroups).toHaveLength(2)
      expect(childGroups.map((g) => g.label).sort()).toEqual(['emergence', 'feedback'])
    })

    it('flattens tags deeper than MAX_GROUP_DEPTH', () => {
      const cards = [makeCard('c1')]
      const fileToId: Record<string, string> = { '/vault/c1.md': 'a1' }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems/feedback/positive'])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      const childGroups = Object.values(result.groupsById).filter((g) => g.parentGroupId !== null)
      expect(childGroups).toHaveLength(1)
      expect(childGroups[0].label).toBe('feedback/positive')
      expect(childGroups[0].provenance).toEqual({
        kind: 'user-tag',
        tagPaths: ['systems/feedback/positive']
      })
    })
  })

  describe('Step 5: inter-group edges', () => {
    it('computes inter-group edges with kindDistribution', () => {
      const cards = [makeCard('c1'), makeCard('c2')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', ['models'])
      }
      const graphEdges = [
        { source: 'a1', target: 'a2', kind: 'connection' },
        { source: 'a1', target: 'a2', kind: 'related' }
      ]

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges
      })

      expect(result.interGroupEdges).toHaveLength(1)
      expect(result.interGroupEdges[0].weight).toBe(2)
      expect(result.interGroupEdges[0].kindDistribution).toEqual({
        connection: 1,
        related: 1
      })
    })
  })

  describe('Step 6: assembly', () => {
    it('assigns color tokens alphabetically', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['beta']),
        a2: makeArtifact('a2', ['alpha']),
        a3: makeArtifact('a3', ['gamma'])
      }

      const result = computeOntologySnapshot({
        cards,
        fileToId,
        artifacts,
        graphEdges: []
      })

      const groups = Object.values(result.groupsById).filter((g) => g.parentGroupId === null)
      const sorted = [...groups].sort((a, b) => a.label.localeCompare(b.label))
      expect(sorted[0].colorToken).toBe('ontology-green') // alpha = 1st
      expect(sorted[1].colorToken).toBe('ontology-blue') // beta = 2nd
      expect(sorted[2].colorToken).toBe('ontology-orange') // gamma = 3rd
    })

    it('produces deterministic revisionId', () => {
      const args = {
        cards: [makeCard('c1')],
        fileToId: { '/vault/c1.md': 'a1' },
        artifacts: { a1: makeArtifact('a1', ['tag']) },
        graphEdges: []
      }

      const result1 = computeOntologySnapshot(args)
      const result2 = computeOntologySnapshot(args)
      expect(result1.revisionId).toBe(result2.revisionId)
    })
  })

  describe('Step 4: link-based sub-grouping', () => {
    it('creates child groups from heavily linked cards', () => {
      // 5 cards in same tag group, 3 of them mutually linked
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3'), makeCard('c4'), makeCard('c5')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3',
        '/vault/c4.md': 'a4',
        '/vault/c5.md': 'a5'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', ['systems']),
        a3: makeArtifact('a3', ['systems']),
        a4: makeArtifact('a4', ['systems']),
        a5: makeArtifact('a5', ['systems'])
      }
      // a1, a2, a3 are heavily connected (connection = weight 3 each)
      const graphEdges = [
        { source: 'a1', target: 'a2', kind: 'connection' },
        { source: 'a2', target: 'a3', kind: 'connection' },
        { source: 'a1', target: 'a3', kind: 'connection' }
      ]

      const result = computeOntologySnapshot({ cards, fileToId, artifacts, graphEdges })

      const childGroups = Object.values(result.groupsById).filter((g) => g.parentGroupId !== null)
      expect(childGroups.length).toBeGreaterThanOrEqual(1)
      // The cluster of a1,a2,a3 should be a child group
      const clusterGroup = childGroups.find((g) => g.cardIds.length === 3)
      expect(clusterGroup).toBeDefined()
      expect(clusterGroup!.provenance.kind).toBe('link-analysis')
    })

    it('does not create child groups below LINK_CLUSTER_MIN_SIZE', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', ['systems']),
        a3: makeArtifact('a3', ['systems'])
      }
      // Only 2 cards linked — below LINK_CLUSTER_MIN_SIZE of 3
      const graphEdges = [{ source: 'a1', target: 'a2', kind: 'connection' }]

      const result = computeOntologySnapshot({ cards, fileToId, artifacts, graphEdges })

      const childGroups = Object.values(result.groupsById).filter((g) => g.parentGroupId !== null)
      expect(childGroups).toHaveLength(0)
    })

    it('uses edge weight table correctly', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3'), makeCard('c4')]
      const fileToId: Record<string, string> = {
        '/vault/c1.md': 'a1',
        '/vault/c2.md': 'a2',
        '/vault/c3.md': 'a3',
        '/vault/c4.md': 'a4'
      }
      const artifacts: Record<string, TestArtifact> = {
        a1: makeArtifact('a1', ['systems']),
        a2: makeArtifact('a2', ['systems']),
        a3: makeArtifact('a3', ['systems']),
        a4: makeArtifact('a4', ['systems'])
      }
      // appears_in edges have weight 0 — should not form clusters
      const graphEdges = [
        { source: 'a1', target: 'a2', kind: 'appears_in' },
        { source: 'a2', target: 'a3', kind: 'appears_in' },
        { source: 'a3', target: 'a1', kind: 'appears_in' }
      ]

      const result = computeOntologySnapshot({ cards, fileToId, artifacts, graphEdges })

      const childGroups = Object.values(result.groupsById).filter((g) => g.parentGroupId !== null)
      expect(childGroups).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('empty input returns empty snapshot', () => {
      const result = computeOntologySnapshot({
        cards: [],
        fileToId: {},
        artifacts: {},
        graphEdges: []
      })
      expect(result.rootGroupIds).toEqual([])
      expect(result.ungroupedNoteIds).toEqual([])
      expect(result.auxiliaryCardIds).toEqual([])
    })

    it('single card with tag creates a single group', () => {
      const result = computeOntologySnapshot({
        cards: [makeCard('c1')],
        fileToId: { '/vault/c1.md': 'a1' },
        artifacts: { a1: makeArtifact('a1', ['solo']) },
        graphEdges: []
      })
      expect(result.rootGroupIds).toHaveLength(1)
    })
  })
})

describe('full pipeline integration', () => {
  it('snapshot → layout → cards within frames', () => {
    // Set up 6 cards across 2 tags with cross-group links
    const cards = [
      makeCard('c1'),
      makeCard('c2'),
      makeCard('c3'),
      makeCard('c4'),
      makeCard('c5'),
      makeCard('c6')
    ]
    const fileToId: Record<string, string> = {
      '/vault/c1.md': 'a1',
      '/vault/c2.md': 'a2',
      '/vault/c3.md': 'a3',
      '/vault/c4.md': 'a4',
      '/vault/c5.md': 'a5',
      '/vault/c6.md': 'a6'
    }
    const artifacts: Record<string, TestArtifact> = {
      a1: makeArtifact('a1', ['systems']),
      a2: makeArtifact('a2', ['systems']),
      a3: makeArtifact('a3', ['systems']),
      a4: makeArtifact('a4', ['models']),
      a5: makeArtifact('a5', ['models']),
      a6: makeArtifact('a6', ['models'])
    }
    const graphEdges = [{ source: 'a1', target: 'a4', kind: 'connection' }]

    const snapshot = computeOntologySnapshot({ cards, fileToId, artifacts, graphEdges })
    const cardSizes = Object.fromEntries(cards.map((c) => [c.id, { width: 200, height: 100 }]))
    const layout = computeOntologyLayout(snapshot, cardSizes, { x: 0, y: 0 })

    // Verify every grouped card is inside its group frame
    for (const group of Object.values(snapshot.groupsById)) {
      const frame = layout.groupFrames[group.id]
      if (!frame) continue

      for (const cardId of group.cardIds) {
        const pos = layout.cardPositions[cardId]
        expect(pos).toBeDefined()
        expect(pos.x).toBeGreaterThanOrEqual(frame.x)
        expect(pos.y).toBeGreaterThanOrEqual(frame.y)
      }
    }

    // Verify inter-group edge exists
    expect(snapshot.interGroupEdges).toHaveLength(1)
    expect(snapshot.interGroupEdges[0].weight).toBe(1)
  })
})
