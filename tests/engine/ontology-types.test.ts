import { describe, it, expect } from 'vitest'
import {
  groupId,
  revisionId,
  type GroupId,
  type RevisionId,
  type OntologyGroupNode,
  type OntologySnapshot,
  type GroupProvenance,
  type InterGroupEdge,
  type GroupFrame,
  type OntologyLayoutResult,
  type OntologyAgentInput,
  type OntologyAgentProposal,
  ONTOLOGY_COLOR_TOKENS,
  MAX_GROUP_DEPTH,
  LINK_CLUSTER_MIN_SIZE
} from '@shared/engine/ontology-types'

describe('ontology-types', () => {
  describe('branded types', () => {
    it('groupId creates a GroupId', () => {
      const id: GroupId = groupId('g1')
      expect(id).toBe('g1')
    })

    it('revisionId creates a RevisionId', () => {
      const id: RevisionId = revisionId('rev1')
      expect(id).toBe('rev1')
    })
  })

  describe('serialization round-trip', () => {
    it('OntologySnapshot survives JSON round-trip', () => {
      const snapshot: OntologySnapshot = {
        revisionId: revisionId('rev-abc'),
        createdAt: '2026-03-31T00:00:00Z',
        rootGroupIds: [groupId('g1')],
        groupsById: {
          g1: {
            id: groupId('g1'),
            label: 'Systems',
            parentGroupId: null,
            colorToken: 'ontology-green',
            cardIds: ['card-1', 'card-2'],
            provenance: { kind: 'user-tag', tagPaths: ['systems'] }
          }
        },
        ungroupedNoteIds: ['card-3'],
        auxiliaryCardIds: ['card-4'],
        interGroupEdges: []
      }

      const json = JSON.stringify(snapshot)
      const parsed: OntologySnapshot = JSON.parse(json)
      expect(parsed).toEqual(snapshot)
    })

    it('InterGroupEdge with kindDistribution survives round-trip', () => {
      const edge: InterGroupEdge = {
        fromGroupId: groupId('g1'),
        toGroupId: groupId('g2'),
        weight: 5,
        kindDistribution: { connection: 2, related: 3 }
      }

      const parsed: InterGroupEdge = JSON.parse(JSON.stringify(edge))
      expect(parsed).toEqual(edge)
    })

    it('OntologyLayoutResult survives round-trip', () => {
      const layout: OntologyLayoutResult = {
        snapshotRevisionId: revisionId('rev-abc'),
        cardPositions: { 'card-1': { x: 100, y: 200 } },
        groupFrames: {
          g1: {
            groupId: groupId('g1'),
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            padding: 32,
            isRoot: true
          }
        }
      }

      const parsed: OntologyLayoutResult = JSON.parse(JSON.stringify(layout))
      expect(parsed).toEqual(layout)
    })
  })

  describe('provenance exhaustiveness', () => {
    it('all four provenance kinds are constructible', () => {
      const userTag: GroupProvenance = { kind: 'user-tag', tagPaths: ['a'] }
      const linkAnalysis: GroupProvenance = {
        kind: 'link-analysis',
        algorithm: 'weighted-components',
        confidence: 0.8
      }
      const aiInference: GroupProvenance = {
        kind: 'ai-inference',
        agentId: 'a1',
        runId: 'r1',
        model: 'opus',
        confidence: 0.9,
        reasoning: 'test'
      }
      const hybrid: GroupProvenance = {
        kind: 'hybrid',
        strategy: 'user-override',
        confidence: 1.0
      }

      expect(userTag.kind).toBe('user-tag')
      expect(linkAnalysis.kind).toBe('link-analysis')
      expect(aiInference.kind).toBe('ai-inference')
      expect(hybrid.kind).toBe('hybrid')
    })
  })

  describe('constants', () => {
    it('ONTOLOGY_COLOR_TOKENS has 8 entries', () => {
      expect(ONTOLOGY_COLOR_TOKENS).toHaveLength(8)
    })

    it('MAX_GROUP_DEPTH is 2', () => {
      expect(MAX_GROUP_DEPTH).toBe(2)
    })

    it('LINK_CLUSTER_MIN_SIZE is 3', () => {
      expect(LINK_CLUSTER_MIN_SIZE).toBe(3)
    })
  })
})
