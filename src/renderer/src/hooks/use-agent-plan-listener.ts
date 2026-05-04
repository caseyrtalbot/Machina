import { useEffect } from 'react'
import { useCanvasStore } from '../store/canvas-store'

/**
 * Subscribes to canvas:agent-plan-accepted IPC events and applies
 * validated agent mutation plans to the canvas store.
 *
 * Plans only apply when the dispatched canvasPath matches the
 * currently loaded canvas. Without this check, a plan dispatched for
 * canvas A while the renderer has canvas B loaded would silently
 * mutate B in memory. When the plan targets a canvas that is not
 * currently loaded, the agent-side tool's direct disk write is the
 * canonical state for that file and no in-memory update is needed.
 *
 * Mount this hook in any component that should receive agent canvas mutations.
 */
export function useAgentPlanListener(): void {
  useEffect(() => {
    const unsubscribe = window.api.on.canvasAgentPlanAccepted((data) => {
      const state = useCanvasStore.getState()
      if (state.filePath !== data.canvasPath) return
      state.applyAgentPlan(data.plan)
    })

    return unsubscribe
  }, [])
}
