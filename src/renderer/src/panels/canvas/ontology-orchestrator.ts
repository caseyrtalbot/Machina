/**
 * Orchestrator hook for ontology organize flow.
 *
 * Manages the worker lifecycle: gathers canvas + vault state,
 * dispatches to the ontology web worker, and surfaces results
 * for preview/apply. Follows the phase state machine pattern
 * from folder-map-orchestrator.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import type { OntologySnapshot, OntologyLayoutResult } from '@shared/engine/ontology-types'
import type { OntologyWorkerResponse } from './ontology-worker'
import { applyOntologyResult } from './ontology-apply'
import type { CommandStack } from './canvas-commands'

export type OntologyPhase = 'idle' | 'processing' | 'preview' | 'error'

export interface OntologyOrchestratorState {
  readonly phase: OntologyPhase
  readonly errorMessage: string | null
  readonly pendingSnapshot: OntologySnapshot | null
  readonly pendingLayout: OntologyLayoutResult | null
}

const IDLE_STATE: OntologyOrchestratorState = {
  phase: 'idle',
  errorMessage: null,
  pendingSnapshot: null,
  pendingLayout: null
}

export function useOntologyOrchestrator(commandStack: React.RefObject<CommandStack | null>) {
  const [state, setState] = useState<OntologyOrchestratorState>(IDLE_STATE)
  const workerRef = useRef<Worker | null>(null)

  // Terminate worker on unmount (safety net for KeepAlive teardown)
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const startOrganize = useCallback(() => {
    const { nodes, viewport } = useCanvasStore.getState()
    const { fileToId, artifacts, graph } = useVaultStore.getState()

    if (nodes.length === 0) return

    setState({
      phase: 'processing',
      errorMessage: null,
      pendingSnapshot: null,
      pendingLayout: null
    })

    // Build card data for worker
    const cards = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content
    }))

    // Build card sizes
    const cardSizes: Record<string, { width: number; height: number }> = {}
    for (const n of nodes) {
      cardSizes[n.id] = { width: n.size.width, height: n.size.height }
    }

    // Build artifacts map with safe defaults for optional fields
    const artifactsMap: Record<
      string,
      {
        id: string
        tags: readonly string[]
        bodyLinks: readonly string[]
        connections: readonly string[]
        concepts: readonly string[]
        title: string
      }
    > = {}
    for (const a of artifacts) {
      artifactsMap[a.id] = {
        id: a.id,
        tags: a.tags,
        bodyLinks: a.bodyLinks ?? [],
        connections: a.connections ?? [],
        concepts: a.concepts ?? [],
        title: a.title
      }
    }

    // Canvas center as layout origin
    const origin = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom }

    // Terminate any prior worker
    if (workerRef.current) {
      workerRef.current.terminate()
    }

    const worker = new Worker(new URL('./ontology-worker.ts', import.meta.url), {
      type: 'module'
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<OntologyWorkerResponse>) => {
      const response = event.data
      if (response.type === 'result') {
        setState({
          phase: 'preview',
          errorMessage: null,
          pendingSnapshot: response.snapshot,
          pendingLayout: response.layout
        })
      } else {
        setState({
          phase: 'error',
          errorMessage: response.message,
          pendingSnapshot: null,
          pendingLayout: null
        })
      }
    }

    worker.onerror = (err) => {
      setState({
        phase: 'error',
        errorMessage: err.message ?? 'Worker error',
        pendingSnapshot: null,
        pendingLayout: null
      })
    }

    worker.postMessage({
      type: 'compute',
      cards,
      fileToId,
      artifacts: artifactsMap,
      graphEdges: graph.edges,
      cardSizes,
      origin
    })
  }, [])

  const applyResult = useCallback(() => {
    if (!state.pendingSnapshot || !state.pendingLayout || !commandStack.current) return
    applyOntologyResult(state.pendingSnapshot, state.pendingLayout, commandStack.current)
    setState(IDLE_STATE)
  }, [state.pendingSnapshot, state.pendingLayout, commandStack])

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setState(IDLE_STATE)
  }, [])

  return {
    ...state,
    startOrganize,
    applyResult,
    cancel
  }
}
