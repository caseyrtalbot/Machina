import { useCanvas } from './canvas-store-context'

export function ZoomIndicator() {
  const zoom = useCanvas((s) => s.viewport.zoom)
  const zoomPercent = Math.round(zoom * 100)

  // key={zoomPercent} forces remount on zoom change, restarting the CSS animation.
  // Pure CSS approach: no state, no refs, no effects. The animation holds at
  // opacity 1 for ~1.3s then fades to 0 over ~0.4s.
  return (
    <div key={zoomPercent} className="canvas-zoom-indicator te-cv-zoom-indicator">
      {zoomPercent}%
    </div>
  )
}
