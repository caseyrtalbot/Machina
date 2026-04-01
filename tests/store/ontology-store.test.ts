import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@renderer/store/canvas-store'
import { groupId, revisionId } from '@shared/engine/ontology-types'
import type { OntologySnapshot, OntologyLayoutResult } from '@shared/engine/ontology-types'

function makeTestSnapshot(): OntologySnapshot {
  return {
    revisionId: revisionId('test-rev'),
    createdAt: '2026-03-31T00:00:00Z',
    rootGroupIds: [groupId('g1'), groupId('g2')],
    groupsById: {
      g1: {
        id: groupId('g1'),
        label: 'Systems',
        parentGroupId: null,
        colorToken: 'ontology-green',
        cardIds: ['c1', 'c2'],
        provenance: { kind: 'user-tag', tagPaths: ['systems'] }
      },
      g2: {
        id: groupId('g2'),
        label: 'Models',
        parentGroupId: null,
        colorToken: 'ontology-blue',
        cardIds: ['c3'],
        provenance: { kind: 'user-tag', tagPaths: ['models'] }
      },
      g1a: {
        id: groupId('g1a'),
        label: 'feedback',
        parentGroupId: groupId('g1'),
        colorToken: 'ontology-green',
        cardIds: ['c4'],
        provenance: { kind: 'user-tag', tagPaths: ['systems/feedback'] }
      }
    },
    ungroupedNoteIds: [],
    auxiliaryCardIds: [],
    interGroupEdges: [
      {
        fromGroupId: groupId('g1'),
        toGroupId: groupId('g2'),
        weight: 2,
        kindDistribution: { connection: 2 }
      }
    ]
  }
}

function makeTestLayout(): OntologyLayoutResult {
  return {
    snapshotRevisionId: revisionId('test-rev'),
    cardPositions: {
      c1: { x: 50, y: 80 },
      c2: { x: 300, y: 80 },
      c3: { x: 600, y: 80 },
      c4: { x: 50, y: 250 }
    },
    groupFrames: {
      g1: {
        groupId: groupId('g1'),
        x: 0,
        y: 0,
        width: 500,
        height: 400,
        padding: 32,
        isRoot: true
      },
      g2: {
        groupId: groupId('g2'),
        x: 620,
        y: 0,
        width: 300,
        height: 200,
        padding: 32,
        isRoot: true
      },
      g1a: {
        groupId: groupId('g1a'),
        x: 20,
        y: 200,
        width: 460,
        height: 180,
        padding: 20,
        isRoot: false
      }
    }
  }
}

describe('canvas-store ontology actions', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('applyOntology sets snapshot and layout', () => {
    const snapshot = makeTestSnapshot()
    const layout = makeTestLayout()
    useCanvasStore.getState().applyOntology(snapshot, layout)

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot).toEqual(snapshot)
    expect(state.ontologyLayout).toEqual(layout)
    expect(state.ontologyIsStale).toBe(false)
  })

  it('clearOntology resets ontology state', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    useCanvasStore.getState().clearOntology()

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot).toBeNull()
    expect(state.ontologyLayout).toBeNull()
  })

  it('moveCardToSection updates cardIds', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    useCanvasStore.getState().moveCardToSection('c1', groupId('g2'))

    const state = useCanvasStore.getState()
    const g1 = state.ontologySnapshot!.groupsById.g1
    const g2 = state.ontologySnapshot!.groupsById.g2
    expect(g1.cardIds).not.toContain('c1')
    expect(g2.cardIds).toContain('c1')
  })

  it('moveCardToSection removes empty group', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    // Move c3 (only card in g2) to g1
    useCanvasStore.getState().moveCardToSection('c3', groupId('g1'))

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot!.groupsById.g2).toBeUndefined()
    expect(state.ontologySnapshot!.rootGroupIds).not.toContain(groupId('g2'))
  })

  it('removeSection moves cards to ungrouped', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    useCanvasStore.getState().removeSection(groupId('g2'))

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot!.groupsById.g2).toBeUndefined()
    expect(state.ontologySnapshot!.ungroupedNoteIds).toContain('c3')
  })

  it('removeSection with children moves all cards to ungrouped', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    useCanvasStore.getState().removeSection(groupId('g1'))

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot!.groupsById.g1).toBeUndefined()
    expect(state.ontologySnapshot!.groupsById.g1a).toBeUndefined()
    expect(state.ontologySnapshot!.ungroupedNoteIds).toContain('c1')
    expect(state.ontologySnapshot!.ungroupedNoteIds).toContain('c2')
    expect(state.ontologySnapshot!.ungroupedNoteIds).toContain('c4')
  })

  it('updateSection cascades colorToken to children', () => {
    useCanvasStore.getState().applyOntology(makeTestSnapshot(), makeTestLayout())
    useCanvasStore.getState().updateSection(groupId('g1'), { colorToken: 'ontology-red' })

    const state = useCanvasStore.getState()
    expect(state.ontologySnapshot!.groupsById.g1.colorToken).toBe('ontology-red')
    expect(state.ontologySnapshot!.groupsById.g1a.colorToken).toBe('ontology-red')
  })
})
