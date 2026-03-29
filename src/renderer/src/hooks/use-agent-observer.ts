import { useEffect, useRef } from 'react'
import { useAgentStates } from './use-agent-states'
import { useCanvasStore } from '../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'
import { computeAgentPlacement } from '../panels/canvas/agent-placement'
import type { AgentSidecarState } from '@shared/agent-types'

/**
 * Map AgentSidecarState status to AgentSessionStatus for card display.
 * tmux reports 'alive' | 'idle' | 'exited', cards show 'active' | 'idle' | 'completed'.
 */
function mapStatus(tmuxStatus: AgentSidecarState['status']): string {
  switch (tmuxStatus) {
    case 'alive':
      return 'active'
    case 'exited':
      return 'completed'
    default:
      return 'idle'
  }
}

/**
 * Build card metadata from an AgentSidecarState.
 */
function buildMetadata(state: AgentSidecarState): Record<string, unknown> {
  return {
    sessionId: state.sessionId,
    status: mapStatus(state.status),
    filesTouched: state.sidecar?.filesTouched ?? [],
    startedAt: state.startedAt ? new Date(state.startedAt).getTime() : Date.now(),
    lastActivity: state.lastActivity ? new Date(state.lastActivity).getTime() : Date.now(),
    currentCommand: state.currentCommand,
    cwd: state.cwd,
    label: state.label,
    currentTask: state.sidecar?.currentTask,
    agentType: state.sidecar?.agentType
  }
}

/**
 * Observes agent states and reconciles them with canvas cards.
 * Creates new cards for unknown sessions, updates metadata for existing ones.
 *
 * Reads nodes, viewport, addNode, and updateNodeMetadata imperatively via
 * useCanvasStore.getState() so the effect only re-runs when agent states change,
 * avoiding wasted cycles from canvas store reference churn.
 */
export function useAgentObserver(): void {
  const states = useAgentStates()

  // Track which sessions we've already processed to avoid re-creating on re-render
  const processedRef = useRef(new Set<string>())

  useEffect(() => {
    if (states.length === 0) return

    const { nodes, viewport, addNode, updateNodeMetadata } = useCanvasStore.getState()

    const existingSessionIds = new Set(
      nodes.filter((n) => n.type === 'agent-session').map((n) => n.metadata.sessionId as string)
    )

    for (const state of states) {
      const metadata = buildMetadata(state)

      if (existingSessionIds.has(state.sessionId)) {
        // Update existing card
        const card = nodes.find(
          (n) => n.type === 'agent-session' && n.metadata.sessionId === state.sessionId
        )
        if (card) {
          updateNodeMetadata(card.id, metadata)
        }
      } else if (!processedRef.current.has(state.sessionId)) {
        // Create new card at viewport center
        processedRef.current.add(state.sessionId)
        const placementViewport = {
          ...viewport,
          width: globalThis.innerWidth ?? 1200,
          height: globalThis.innerHeight ?? 800
        }
        const position = computeAgentPlacement(nodes, placementViewport)
        const node = createCanvasNode('agent-session', position, { metadata })
        addNode(node)
      }
    }

    // Mark exited sessions that are no longer in the state list
    // and clean up processedRef so cards can be re-created if needed
    for (const node of nodes) {
      if (node.type !== 'agent-session') continue
      const sessionId = node.metadata.sessionId as string
      const stillPresent = states.some((s) => s.sessionId === sessionId)
      if (!stillPresent && node.metadata.status !== 'completed') {
        updateNodeMetadata(node.id, { status: 'completed' })
        processedRef.current.delete(sessionId)
      }
    }
  }, [states])
}
