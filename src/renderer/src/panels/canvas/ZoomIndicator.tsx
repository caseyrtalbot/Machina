import { useCanvasStore } from '../../store/canvas-store'
import { borderRadius, colors, typography } from '../../design/tokens'

export function ZoomIndicator() {
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const zoomPercent = Math.round(zoom * 100)

  // key={zoomPercent} forces remount on zoom change, restarting the CSS animation.
  // Pure CSS approach: no state, no refs, no effects. The animation holds at
  // opacity 1 for ~1.3s then fades to 0 over ~0.4s.
  return (
    <div
      key={zoomPercent}
      className="canvas-zoom-indicator absolute bottom-3 right-3 pointer-events-none"
      style={{
        padding: '3px 10px',
        background: 'color-mix(in srgb, var(--canvas-card-bg) 92%, transparent)',
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline,
        color: colors.text.secondary,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        animation: 'te-zoom-fade 1.7s ease forwards',
        zIndex: 10
      }}
    >
      {zoomPercent}%
    </div>
  )
}
