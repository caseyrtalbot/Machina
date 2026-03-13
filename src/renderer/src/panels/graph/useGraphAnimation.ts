import { useRef, useCallback, useEffect } from 'react'
import type { SimNode } from './GraphRenderer'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NodeDiff {
  added: readonly SimNode[]
  removed: readonly SimNode[]
  kept: readonly SimNode[]
}

export interface RenameEntry {
  id: string
  oldX: number
  oldY: number
}

export interface AnimatingNode {
  id: string
  progress: number
  type: 'enter' | 'exit'
  startTime: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTER_DURATION = 400
const EXIT_DURATION = 200
const REHEAT_ALPHA = 0.3

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Set-based diff of two node arrays by ID.
 * Returns three immutable arrays: added, removed, kept.
 */
export function diffNodes(prev: readonly SimNode[], next: readonly SimNode[]): NodeDiff {
  const prevIds = new Set(prev.map((n) => n.id))
  const nextIds = new Set(next.map((n) => n.id))

  const added = next.filter((n) => !prevIds.has(n.id))
  const removed = prev.filter((n) => !nextIds.has(n.id))
  const kept = next.filter((n) => prevIds.has(n.id))

  return { added, removed, kept }
}

/**
 * Given the removed and added arrays from diffNodes, find pairs where the
 * same ID appears in both (which happens when a node is re-keyed or renamed
 * at the store level). Returns the old position for each matched entry so
 * the renderer can animate from the previous location.
 */
export function detectRenames(
  removed: readonly SimNode[],
  added: readonly SimNode[]
): readonly RenameEntry[] {
  const addedIds = new Set(added.map((n) => n.id))

  return removed
    .filter((n) => addedIds.has(n.id))
    .map((n) => ({ id: n.id, oldX: n.x, oldY: n.y }))
}

// ---------------------------------------------------------------------------
// Hook internals
// ---------------------------------------------------------------------------

interface AnimationBatch {
  enterNodes: Map<string, AnimatingNode>
  exitNodes: Map<string, AnimatingNode>
}

interface PendingChange {
  entering: SimNode[]
  exiting: SimNode[]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useGraphAnimation manages enter/exit animation state for graph nodes.
 *
 * onRestart: called with an alpha value whenever the simulation should be
 *            reheated (e.g. after adding nodes).
 * reducedMotion: when true, animations are skipped entirely.
 */
export function useGraphAnimation(
  onRestart: (alpha: number) => void,
  reducedMotion: boolean
): {
  queueEnter: (nodes: SimNode[]) => void
  queueExit: (nodes: SimNode[]) => void
  getNodeTransition: (nodeId: string, now: number) => { opacity: number; scale: number }
  hasActiveAnimations: () => boolean
  diffNodes: typeof diffNodes
  detectRenames: typeof detectRenames
} {
  const batchRef = useRef<AnimationBatch>({
    enterNodes: new Map(),
    exitNodes: new Map()
  })

  const pendingRef = useRef<PendingChange>({ entering: [], exiting: [] })
  const rafIdRef = useRef<number | null>(null)

  // Flush accumulated pending changes into the animation batch.
  const flushPendingChanges = useCallback(() => {
    rafIdRef.current = null

    const { entering, exiting } = pendingRef.current
    pendingRef.current = { entering: [], exiting: [] }

    if (reducedMotion) {
      // Skip animation setup; nodes appear/disappear instantly.
      if (entering.length > 0) {
        onRestart(REHEAT_ALPHA)
      }
      return
    }

    const now = performance.now()

    for (const node of exiting) {
      batchRef.current.exitNodes.set(node.id, {
        id: node.id,
        progress: 0,
        type: 'exit',
        startTime: now
      })
    }

    for (const node of entering) {
      batchRef.current.enterNodes.set(node.id, {
        id: node.id,
        progress: 0,
        type: 'enter',
        startTime: now
      })
    }

    if (entering.length > 0) {
      onRestart(REHEAT_ALPHA)
    }
  }, [onRestart, reducedMotion])

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(flushPendingChanges)
  }, [flushPendingChanges])

  const queueEnter = useCallback(
    (nodes: SimNode[]) => {
      if (nodes.length === 0) return
      pendingRef.current = {
        ...pendingRef.current,
        entering: [...pendingRef.current.entering, ...nodes]
      }
      scheduleFlush()
    },
    [scheduleFlush]
  )

  const queueExit = useCallback(
    (nodes: SimNode[]) => {
      if (nodes.length === 0) return
      pendingRef.current = {
        ...pendingRef.current,
        exiting: [...pendingRef.current.exiting, ...nodes]
      }
      scheduleFlush()
    },
    [scheduleFlush]
  )

  /**
   * Returns the current visual state for a node.
   * Cleans up completed animations as a side-effect.
   *
   * Enter: 400ms ease-out cubic, scale 0.5 -> 1, opacity 0 -> 1
   * Exit:  200ms linear, scale 1 -> 0.5, opacity 1 -> 0
   */
  const getNodeTransition = useCallback(
    (nodeId: string, now: number): { opacity: number; scale: number } => {
      const { enterNodes, exitNodes } = batchRef.current

      const entering = enterNodes.get(nodeId)
      if (entering) {
        const elapsed = now - entering.startTime
        const t = Math.min(elapsed / ENTER_DURATION, 1)
        // Ease-out cubic: 1 - (1-t)^3
        const eased = 1 - Math.pow(1 - t, 3)
        const opacity = eased
        const scale = 0.5 + eased * 0.5

        if (t >= 1) {
          enterNodes.delete(nodeId)
        }

        return { opacity, scale }
      }

      const exiting = exitNodes.get(nodeId)
      if (exiting) {
        const elapsed = now - exiting.startTime
        const t = Math.min(elapsed / EXIT_DURATION, 1)
        const opacity = 1 - t
        const scale = 1 - t * 0.5

        if (t >= 1) {
          exitNodes.delete(nodeId)
        }

        return { opacity, scale }
      }

      return { opacity: 1, scale: 1 }
    },
    []
  )

  const hasActiveAnimations = useCallback((): boolean => {
    return batchRef.current.enterNodes.size > 0 || batchRef.current.exitNodes.size > 0
  }, [])

  // Cancel any pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  return {
    queueEnter,
    queueExit,
    getNodeTransition,
    hasActiveAnimations,
    diffNodes,
    detectRenames
  }
}
