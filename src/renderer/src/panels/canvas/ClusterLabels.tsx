import { useCanvas } from './canvas-store-context'
import { colors, typography } from '../../design/tokens'

/**
 * Renders floating cluster name labels in canvas coordinate space.
 * Labels appear after a semantic organize and clear when any card is moved.
 */
export function ClusterLabels({
  viewport
}: {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number }
}) {
  const labels = useCanvas((s) => s.clusterLabels)

  if (labels.length === 0) return null

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 4 }}>
      {labels.map((label) => {
        const screenX = label.position.x * viewport.zoom + viewport.x
        const screenY = label.position.y * viewport.zoom + viewport.y

        return (
          <div
            key={label.label}
            className="absolute"
            style={{
              left: screenX,
              top: screenY - 4 * viewport.zoom,
              transform: `scale(${viewport.zoom})`,
              transformOrigin: 'bottom left',
              fontFamily: typography.fontFamily.mono,
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: colors.text.muted,
              opacity: 0.6,
              whiteSpace: 'nowrap'
            }}
          >
            {label.label}
          </div>
        )
      })}
    </div>
  )
}
