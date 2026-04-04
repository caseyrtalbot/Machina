import { useCallback, useRef, useEffect } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { perfMark, perfMeasure } from '../../utils/perf-marks'

let vpInteractionTimer: ReturnType<typeof setTimeout> | null = null

function markViewportInteracting(active: boolean) {
  if (vpInteractionTimer) clearTimeout(vpInteractionTimer)
  if (active) {
    useCanvasStore.getState().setInteracting(true)
  } else {
    vpInteractionTimer = setTimeout(() => {
      useCanvasStore.getState().setInteracting(false)
    }, 150)
  }
}

const ZOOM_MIN = 0.1
const ZOOM_MAX = 3.0
const ZOOM_SENSITIVITY = 0.001

interface ViewportHandlers {
  onWheel: (e: WheelEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
}

export function useCanvasViewport(
  containerRef: React.RefObject<HTMLDivElement | null>
): ViewportHandlers {
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const spaceHeld = useRef(false)

  // Track Space key for space+drag panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) spaceHeld.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // RAF coalescing for wheel events (zoom + scroll-pan).
  // Trackpads fire wheel at 120Hz+; this caps updates to display refresh rate.
  const wheelRaf = useRef(0)
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null)

  const onWheel = useCallback(
    (e: WheelEvent) => {
      // Let wheel events pass through to terminal cards (xterm scrollback)
      const target = e.target as HTMLElement
      if (target.closest('.xterm')) return

      // Focus lock: let wheel events pass through to the locked card's content
      const { lockedCardId } = useCanvasStore.getState()
      if (lockedCardId) {
        // Allow native scroll inside the locked card's content area
        if (target.closest('.canvas-card-content')) return
        // Block canvas interaction outside the locked card
        e.preventDefault()
        return
      }

      e.preventDefault()
      perfMark('wheel-start')
      markViewportInteracting(true)
      const { viewport } = useCanvasStore.getState()
      const container = containerRef.current
      if (!container) return

      if (e.ctrlKey || e.metaKey) {
        // Zoom toward cursor
        const rect = container.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top

        // Accumulate zoom on top of any pending viewport to avoid stale reads
        const base = pendingViewport.current ?? viewport
        const oldZoom = base.zoom
        const delta = -e.deltaY * ZOOM_SENSITIVITY
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZoom * (1 + delta)))
        const scale = newZoom / oldZoom

        pendingViewport.current = {
          x: cursorX - (cursorX - base.x) * scale,
          y: cursorY - (cursorY - base.y) * scale,
          zoom: newZoom
        }
      } else {
        // Pan — accumulate deltas on top of any pending viewport
        const base = pendingViewport.current ?? viewport
        pendingViewport.current = {
          x: base.x - e.deltaX,
          y: base.y - e.deltaY,
          zoom: base.zoom
        }
      }

      if (!wheelRaf.current) {
        wheelRaf.current = requestAnimationFrame(() => {
          wheelRaf.current = 0
          if (pendingViewport.current) {
            useCanvasStore.getState().setViewport(pendingViewport.current)
            pendingViewport.current = null
          }
          markViewportInteracting(false)
          perfMeasure('canvas-wheel', 'wheel-start')
        })
      }
    },
    [containerRef]
  )

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Block panning while a card is focus-locked
    if (useCanvasStore.getState().lockedCardId) return

    // Middle-click or Space+left-click to pan
    const shouldPan = e.button === 1 || (e.button === 0 && spaceHeld.current)
    if (!shouldPan) return

    e.preventDefault()
    perfMark('pan-start')
    isPanning.current = true
    markViewportInteracting(true)
    const { viewport } = useCanvasStore.getState()
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y }

    let latestPanX = viewport.x
    let latestPanY = viewport.y
    let panRafPending = false

    const onMove = (me: PointerEvent) => {
      if (!isPanning.current) return
      latestPanX = panStart.current.vx + (me.clientX - panStart.current.x)
      latestPanY = panStart.current.vy + (me.clientY - panStart.current.y)

      if (!panRafPending) {
        panRafPending = true
        requestAnimationFrame(() => {
          panRafPending = false
          useCanvasStore.getState().setViewport({
            x: latestPanX,
            y: latestPanY,
            zoom: useCanvasStore.getState().viewport.zoom
          })
        })
      }
    }

    const onUp = () => {
      isPanning.current = false
      // Flush final position if a RAF is still pending
      if (panRafPending) {
        useCanvasStore.getState().setViewport({
          x: latestPanX,
          y: latestPanY,
          zoom: useCanvasStore.getState().viewport.zoom
        })
      }
      markViewportInteracting(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      perfMeasure('canvas-pan', 'pan-start')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return { onWheel, onPointerDown }
}
