import { useEffect, useRef } from 'react'
import { useClaudeActivityStore } from '../store/claude-activity-store'
import { useCanvasStore } from '../store/canvas-store'

const GLOW_DURATION_MS = 4000

/**
 * Subscribes to Claude activity IPC events and drives card glow animations.
 * When an activity event matches a canvas node, that node's metadata.isActive
 * is set to true for GLOW_DURATION_MS, then reset to false.
 *
 * Call this hook in the ClaudeConfigPanel when the watcher is running.
 */
export function useClaudeActivity(enabled: boolean): void {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (!enabled) return
    // Guard: preload may not have the claudeActivity listener yet (e.g. during HMR)
    if (typeof window.api?.on?.claudeActivity !== 'function') return

    const timers = timersRef.current

    const unsub = window.api.on.claudeActivity((event) => {
      const nodes = useCanvasStore.getState().nodes
      const matched = useClaudeActivityStore.getState().processEvent(event, nodes)

      for (const nodeId of matched) {
        // Set active
        useCanvasStore.getState().updateNodeMetadata(nodeId, { isActive: true })

        // Clear existing timer for this node (reset the glow duration)
        const existing = timers.get(nodeId)
        if (existing) clearTimeout(existing)

        // Set deactivation timer
        const timer = setTimeout(() => {
          useCanvasStore.getState().updateNodeMetadata(nodeId, { isActive: false })
          useClaudeActivityStore.getState().deactivateNode(nodeId)
          timers.delete(nodeId)
        }, GLOW_DURATION_MS)

        timers.set(nodeId, timer)
      }
    })

    return () => {
      unsub()
      // Clear all timers on unmount
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()

      // Deactivate all nodes
      const activeIds = useClaudeActivityStore.getState().activeNodeIds
      for (const id of activeIds) {
        useCanvasStore.getState().updateNodeMetadata(id, { isActive: false })
      }
      useClaudeActivityStore.getState().clearAll()
    }
  }, [enabled])
}
