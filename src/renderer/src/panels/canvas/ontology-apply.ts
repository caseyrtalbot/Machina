/**
 * Undo-aware application of ontology results to the canvas.
 * Wraps snapshot + layout mutations in a CommandStack command
 * so a single Cmd+Z restores the previous state.
 */

import type { OntologySnapshot, OntologyLayoutResult } from '@shared/engine/ontology-types'
import type { CanvasStoreApi } from '../../store/canvas-store'
import type { CommandStack } from './canvas-commands'

export function applyOntologyResult(
  store: CanvasStoreApi,
  snapshot: OntologySnapshot,
  layout: OntologyLayoutResult,
  commandStack: CommandStack
): void {
  const initial = store.getState()

  // Capture pre-apply state for undo
  const prevPositions = new Map<string, { x: number; y: number }>()
  for (const node of initial.nodes) {
    if (layout.cardPositions[node.id]) {
      prevPositions.set(node.id, { ...node.position })
    }
  }
  const prevSnapshot = initial.ontologySnapshot
  const prevLayout = initial.ontologyLayout

  commandStack.execute({
    execute: () => {
      const s = store.getState()
      // Set ontology semantic + geometry state
      s.applyOntology(snapshot, layout)
      // Move cards to their computed positions
      for (const [cardId, pos] of Object.entries(layout.cardPositions)) {
        const node = s.nodes.find((n) => n.id === cardId)
        if (node) {
          s.moveNode(cardId, pos)
        }
      }
    },
    undo: () => {
      const s = store.getState()
      // Restore previous card positions
      for (const [cardId, pos] of prevPositions) {
        s.moveNode(cardId, pos)
      }
      // Restore previous ontology state
      if (prevSnapshot && prevLayout) {
        s.applyOntology(prevSnapshot, prevLayout)
      } else {
        s.clearOntology()
      }
    }
  })
}
