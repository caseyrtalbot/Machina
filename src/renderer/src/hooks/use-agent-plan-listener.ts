import { useEffect } from 'react'
import { getAllCanvasStores } from '../store/canvas-store'

/**
 * Subscribes to canvas:agent-plan-accepted IPC events and applies
 * validated agent mutation plans to the canvas store.
 *
 * Plans only apply to the loaded instance whose filePath matches the
 * dispatched canvasPath (3.8: one store per canvasId). Without this
 * check, a plan dispatched for canvas A would silently mutate canvas B
 * in memory. When the plan targets a canvas that is not currently
 * loaded, the agent-side tool's direct disk write is the canonical
 * state for that file and no in-memory update is needed.
 *
 * Mount this hook exactly once (App level). It scans the whole store registry
 * per event, so per-view mounts would apply the same plan once per open canvas
 * tab — the duplicate application fails live re-validation and raises a
 * spurious "changes were rejected" toast.
 */
export function useAgentPlanListener(): void {
  useEffect(() => {
    const unsubscribe = window.api.on.canvasAgentPlanAccepted((data) => {
      for (const store of getAllCanvasStores().values()) {
        const state = store.getState()
        if (state.filePath !== data.canvasPath) continue
        state.applyAgentPlan(data.plan)
        return
      }
    })

    return unsubscribe
  }, [])
}
