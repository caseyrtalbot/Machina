import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useGraphStore } from '../../store/graph-store'
import type { SimNode, SimEdge } from './graph-config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HighlightMode = 'idle' | 'hover' | 'click'

export interface HighlightState {
  mode: HighlightMode
  focusedNodeId: string | null
  connectedSet: ReadonlySet<string>
  glowIntensity: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_SET: ReadonlySet<string> = new Set()
const GLOW_FADE_IN_MS = 0
const GLOW_FADE_OUT_MS = 150

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testing)
// ---------------------------------------------------------------------------

/** Extract a string ID from either a string or a SimNode reference. */
export function getEdgeNodeId(node: string | SimNode): string {
  return typeof node === 'string' ? node : node.id
}

/**
 * Build a bidirectional adjacency map from a list of edges.
 * Each node maps to the set of all nodes it is directly connected to.
 */
export function buildAdjacencyList(edges: readonly SimEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()

  for (const edge of edges) {
    const sourceId = getEdgeNodeId(edge.source)
    const targetId = getEdgeNodeId(edge.target)

    if (!map.has(sourceId)) map.set(sourceId, new Set())
    if (!map.has(targetId)) map.set(targetId, new Set())

    map.get(sourceId)!.add(targetId)
    map.get(targetId)!.add(sourceId)
  }

  return map
}

/**
 * Compute the set of the focused node plus its immediate neighbors.
 * This is a depth-1 traversal only (not transitive).
 */
export function computeConnectedSet(
  nodeId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> {
  const neighbors = adjacency.get(nodeId)
  const result = new Set<string>([nodeId])

  if (neighbors) {
    for (const neighborId of neighbors) {
      result.add(neighborId)
    }
  }

  return result
}

/**
 * Quadratic ease-out: starts fast, decelerates toward 1.
 * f(t) = 1 - (1 - t)^2
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2)
}

interface GlowInterpolation {
  value: number
  done: boolean
}

/**
 * Compute the current glow intensity given an animation in progress.
 * Uses GLOW_FADE_IN_MS when animating toward 1, GLOW_FADE_OUT_MS when fading to 0.
 */
export function interpolateGlow(
  startValue: number,
  target: number,
  startTime: number,
  now: number
): GlowInterpolation {
  const duration = target > startValue ? GLOW_FADE_IN_MS : GLOW_FADE_OUT_MS
  // Zero-duration = instant transition
  if (duration <= 0) return { value: target, done: true }
  const elapsed = now - startTime
  const t = Math.min(1, elapsed / duration)
  const eased = easeOut(t)
  const value = startValue + (target - startValue) * eased

  return { value, done: t >= 1 }
}

// ---------------------------------------------------------------------------
// Internal glow tracking shape
// ---------------------------------------------------------------------------

interface GlowTrack {
  current: number
  target: number
  startValue: number
  startTime: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGraphHighlight(edges: readonly SimEdge[]): {
  state: HighlightState
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
  handleHover: (nodeId: string | null) => void
  handleClick: (nodeId: string | null) => void
  handleDoubleClick: (nodeId: string) => void
} {
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)

  // Tracks whether a node is click-locked (prevents hover from changing focus)
  const clickLockedRef = useRef<string | null>(null)

  // Persist the highlight topology during fade-out so the renderer knows which
  // nodes were highlighted while glowIntensity is still non-zero
  const fadeConnectedSetRef = useRef<ReadonlySet<string>>(EMPTY_SET)
  const fadeFocusedNodeIdRef = useRef<string | null>(null)

  // Glow animation tracking
  const glowRef = useRef<GlowTrack>({
    current: 0,
    target: 0,
    startValue: 0,
    startTime: 0
  })
  const rafRef = useRef<number | null>(null)
  const [glowIntensity, setGlowIntensity] = useState(0)

  // Derived: which node is focused and what mode we're in
  const focusedNodeId = clickLockedRef.current ?? hoveredNodeId
  const mode: HighlightMode = clickLockedRef.current ? 'click' : hoveredNodeId ? 'hover' : 'idle'

  // Memoize adjacency list from edges
  const adjacency = useMemo(() => buildAdjacencyList(edges), [edges])

  // Memoize the connected set for the current focused node
  const connectedSet: ReadonlySet<string> = useMemo(() => {
    if (!focusedNodeId) return EMPTY_SET
    return computeConnectedSet(focusedNodeId, adjacency)
  }, [focusedNodeId, adjacency])

  // rAF tick: advance the glow animation one frame
  const tickGlow = useCallback(() => {
    const track = glowRef.current
    const now = performance.now()
    const { value, done } = interpolateGlow(track.startValue, track.target, track.startTime, now)

    track.current = value
    setGlowIntensity(value)

    if (!done) {
      rafRef.current = requestAnimationFrame(tickGlow)
    } else {
      rafRef.current = null
    }
  }, [])

  // Drive glow target based on whether a node is focused
  const setGlowTarget = useCallback(
    (target: number) => {
      const track = glowRef.current

      // Cancel any in-flight animation
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      // Start new animation from the current mid-animation value
      glowRef.current = {
        current: track.current,
        target,
        startValue: track.current,
        startTime: performance.now()
      }

      rafRef.current = requestAnimationFrame(tickGlow)
    },
    [tickGlow]
  )

  // Trigger glow transitions when focus changes; snapshot topology for fade-out
  useEffect(() => {
    if (focusedNodeId) {
      fadeConnectedSetRef.current = connectedSet
      fadeFocusedNodeIdRef.current = focusedNodeId
      setGlowTarget(1)
    } else {
      // Keep refs as-is until glowIntensity reaches 0
      setGlowTarget(0)
    }
  }, [focusedNodeId, connectedSet, setGlowTarget])

  // Clear fade state once the glow animation finishes and there is no active focus
  useEffect(() => {
    if (glowIntensity === 0 && !focusedNodeId) {
      fadeConnectedSetRef.current = EMPTY_SET
      fadeFocusedNodeIdRef.current = null
    }
  }, [glowIntensity, focusedNodeId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleHover = useCallback(
    (nodeId: string | null) => {
      setHoveredNode(nodeId)
    },
    [setHoveredNode]
  )

  const handleClick = useCallback(
    (nodeId: string | null) => {
      clickLockedRef.current = nodeId
      setSelectedNode(nodeId)
    },
    [setSelectedNode]
  )

  const handleDoubleClick = useCallback(
    (_nodeId: string) => {
      clickLockedRef.current = null
      setSelectedNode(null)
      setHoveredNode(null)
    },
    [setSelectedNode, setHoveredNode]
  )

  return {
    state: {
      mode,
      focusedNodeId: focusedNodeId ?? fadeFocusedNodeIdRef.current,
      connectedSet: focusedNodeId ? connectedSet : fadeConnectedSetRef.current,
      glowIntensity
    },
    adjacency,
    handleHover,
    handleClick,
    handleDoubleClick
  }
}
