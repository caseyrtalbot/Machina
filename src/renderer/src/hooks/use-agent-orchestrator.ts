/**
 * Orchestrator hook for user-triggered agent actions.
 *
 * Manages the agent action lifecycle:
 * 1. Extract context from selected cards + 1-hop neighbors
 * 2. Send to main process via IPC for LLM computation
 * 3. Hold the resulting plan in preview state
 * 4. Apply or cancel on user decision
 *
 * Follows the phase machine pattern from ontology-orchestrator.ts.
 *
 * Uses a phaseRef to guard the single-agent lock, avoiding stale
 * closure issues with React's useCallback batching.
 */

import { useCallback, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvas-store'
import { useVaultStore } from '../store/vault-store'
import { extractAgentContext, buildVaultScopeContext } from '../panels/canvas/agent-context'
import type { ArtifactSummary } from '../panels/canvas/agent-context'
import { applyAgentResult } from '../panels/canvas/agent-apply'
import type { AgentActionName } from '@shared/agent-action-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { CommandStack } from '../panels/canvas/canvas-commands'
import { buildTagIndex } from '@shared/engine/tag-index'
import { buildGhostIndex } from '@shared/engine/ghost-index'

export type AgentPhase = 'idle' | 'computing' | 'preview' | 'error'

export interface AgentOrchestratorState {
  readonly phase: AgentPhase
  readonly activeAction: AgentActionName | null
  readonly pendingPlan: CanvasMutationPlan | null
  readonly errorMessage: string | null
}

const IDLE_STATE: AgentOrchestratorState = {
  phase: 'idle',
  activeAction: null,
  pendingPlan: null,
  errorMessage: null
}

export function useAgentOrchestrator(
  commandStack: React.RefObject<CommandStack | null>,
  containerSize: { width: number; height: number }
) {
  const [state, setState] = useState<AgentOrchestratorState>(IDLE_STATE)

  // Ref mirrors state.phase so the trigger guard is never stale
  const phaseRef = useRef<AgentPhase>('idle')

  // Track spawned librarian session ID so the action bar can show running state.
  // Set on spawn, cleared when the session exits (via agent:states-changed).
  const [librarianSessionId, setLibrarianSessionId] = useState<string | null>(null)

  const setPhase = useCallback((next: AgentOrchestratorState) => {
    phaseRef.current = next.phase
    setState(next)
  }, [])

  const trigger = useCallback(
    async (action: AgentActionName) => {
      // Single agent lock — ref is always current, no stale closure risk
      if (phaseRef.current !== 'idle') return

      const { nodes, edges, selectedNodeIds, viewport } = useCanvasStore.getState()

      setPhase({
        phase: 'computing',
        activeAction: action,
        pendingPlan: null,
        errorMessage: null
      })

      // For challenge/emerge with no selection, use vault-scope context
      // instead of sending empty card arrays
      const useVaultScope =
        (action === 'challenge' || action === 'emerge') && selectedNodeIds.size === 0

      const context = useVaultScope
        ? (() => {
            const { artifacts, graph } = useVaultStore.getState()
            const summaries: readonly ArtifactSummary[] = artifacts.map((a) => ({
              id: a.id,
              title: a.title,
              type: a.type,
              signal: a.signal,
              tags: a.tags,
              origin: a.origin
            }))
            const tagTree = buildTagIndex(artifacts)
            const ghosts = buildGhostIndex(graph, artifacts)
            const viewportBounds = {
              x: -viewport.x / viewport.zoom,
              y: -viewport.y / viewport.zoom,
              width: containerSize.width / viewport.zoom,
              height: containerSize.height / viewport.zoom
            }
            return buildVaultScopeContext(action, summaries, tagTree, ghosts, {
              viewportBounds,
              totalCardCount: nodes.length
            })
          })()
        : extractAgentContext(action, nodes, edges, selectedNodeIds, viewport, containerSize)

      try {
        const response = await window.api.agentAction.compute({ action, context })

        if ('error' in response) {
          setPhase({
            phase: 'error',
            activeAction: action,
            pendingPlan: null,
            errorMessage: response.error
          })
          return
        }

        setPhase({
          phase: 'preview',
          activeAction: action,
          pendingPlan: response.plan,
          errorMessage: null
        })
      } catch (err) {
        setPhase({
          phase: 'error',
          activeAction: action,
          pendingPlan: null,
          errorMessage: (err as Error).message
        })
      }
    },
    [containerSize, setPhase]
  )

  const apply = useCallback(() => {
    if (!state.pendingPlan || !commandStack.current) return
    applyAgentResult(state.pendingPlan, commandStack.current)
    setPhase(IDLE_STATE)
  }, [state.pendingPlan, commandStack, setPhase])

  const cancel = useCallback(() => {
    if (phaseRef.current === 'computing') {
      window.api.agentAction.cancel()
    }
    setPhase(IDLE_STATE)
  }, [setPhase])

  return {
    ...state,
    librarianSessionId,
    setLibrarianSessionId,
    trigger,
    apply,
    cancel
  }
}
