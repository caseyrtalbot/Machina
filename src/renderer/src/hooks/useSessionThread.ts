import { useEffect, useRef, useState, useCallback } from 'react'
import type { SessionMilestone } from '@shared/project-canvas-types'

const MAX_MILESTONES = 50
const IDLE_TIMEOUT_MS = 10000
const RETAINED_MILESTONES = 5

export interface SessionThreadState {
  readonly milestones: readonly SessionMilestone[]
  readonly expandedIds: ReadonlySet<string>
  readonly isLive: boolean
  readonly toggle: (id: string) => void
  readonly clear: () => void
}

export function useSessionThread(projectPath: string | null, enabled: boolean): SessionThreadState {
  const [milestones, setMilestones] = useState<readonly SessionMilestone[]>([])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [liveState, setLiveState] = useState(false)
  const lastEventTimeRef = useRef(0)
  const pendingRef = useRef<SessionMilestone[]>([])
  const rafRef = useRef<number | null>(null)

  // Start/stop tailing based on enabled flag
  useEffect(() => {
    if (!enabled || !projectPath) {
      window.api.project.tailStop().catch(() => {})
      return
    }

    window.api.project.tailStart(projectPath).catch(() => {})

    const unsubMilestone = window.api.on.sessionMilestone((milestone) => {
      lastEventTimeRef.current = Date.now()
      setLiveState(true)

      // Batch with rAF to avoid jank from rapid arrivals
      pendingRef.current.push(milestone)
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          const batch = pendingRef.current
          pendingRef.current = []
          rafRef.current = null
          setMilestones((prev) => [...batch, ...prev].slice(0, MAX_MILESTONES))
        })
      }
    })

    return () => {
      unsubMilestone()
      window.api.project.tailStop().catch(() => {})
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled, projectPath])

  // Track idle state (no events for 10 seconds)
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => {
      if (Date.now() - lastEventTimeRef.current > IDLE_TIMEOUT_MS) {
        setLiveState(false)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [enabled])

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setMilestones([])
    setExpandedIds(new Set())
  }, [])

  const visibleMilestones =
    enabled && projectPath ? milestones : milestones.slice(0, RETAINED_MILESTONES)

  return {
    milestones: visibleMilestones,
    expandedIds,
    isLive: enabled && projectPath ? liveState : false,
    toggle,
    clear
  }
}
