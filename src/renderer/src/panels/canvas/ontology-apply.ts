/**
 * Undo-aware application of ontology results to the canvas.
 * Wraps snapshot + layout mutations in a CommandStack command
 * so a single Cmd+Z restores the previous state.
 */

import type { OntologySnapshot, OntologyLayoutResult } from '@shared/engine/ontology-types'
import { useCanvasStore } from '../../store/canvas-store'
import type { CommandStack } from './canvas-commands'

export function applyOntologyResult(
  snapshot: OntologySnapshot,
  layout: OntologyLayoutResult,
  commandStack: CommandStack
): void {
  const store = useCanvasStore.getState()

  // Capture pre-apply state for undo
  const prevPositions = new Map<string, { x: number; y: number }>()
  for (const node of store.nodes) {
    if (layout.cardPositions[node.id]) {
      prevPositions.set(node.id, { ...node.position })
    }
  }
  const prevSnapshot = store.ontologySnapshot
  const prevLayout = store.ontologyLayout

  commandStack.execute({
    execute: () => {
      const s = useCanvasStore.getState()
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
      const s = useCanvasStore.getState()
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
