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
      const { viewport, setViewport } = useCanvasStore.getState()
      const container = containerRef.current
      if (!container) return

      if (e.ctrlKey || e.metaKey) {
        // Zoom toward cursor
        const rect = container.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top

        const oldZoom = viewport.zoom
        const delta = -e.deltaY * ZOOM_SENSITIVITY
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZoom * (1 + delta)))
        const scale = newZoom / oldZoom

        setViewport({
          x: cursorX - (cursorX - viewport.x) * scale,
          y: cursorY - (cursorY - viewport.y) * scale,
          zoom: newZoom
        })
      } else {
        // Pan
        setViewport({
          x: viewport.x - e.deltaX,
          y: viewport.y - e.deltaY,
          zoom: viewport.zoom
        })
      }
      markViewportInteracting(false)
      perfMeasure('canvas-wheel', 'wheel-start')
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

    const onMove = (me: PointerEvent) => {
      if (!isPanning.current) return
      const dx = me.clientX - panStart.current.x
      const dy = me.clientY - panStart.current.y
      useCanvasStore.getState().setViewport({
        x: panStart.current.vx + dx,
        y: panStart.current.vy + dy,
        zoom: useCanvasStore.getState().viewport.zoom
      })
    }

    const onUp = () => {
      isPanning.current = false
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
