import { useCanvas } from './canvas-store-context'

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
    <div className="te-cluster-layer">
      {labels.map((label) => {
        const screenX = label.position.x * viewport.zoom + viewport.x
        const screenY = label.position.y * viewport.zoom + viewport.y

        return (
          <div
            key={label.label}
            className="te-cluster-label"
            style={{
              left: screenX,
              top: screenY - 4 * viewport.zoom,
              transform: `scale(${viewport.zoom})`
            }}
          >
            {label.label}
          </div>
        )
      })}
    </div>
  )
}
