import { useCanvas } from './canvas-store-context'
import { canvasTokens, ontologyColors } from '../../design/tokens'

export function SectionOverlay({
  viewport
}: {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number }
}) {
  const ontologyLayout = useCanvas((s) => s.ontologyLayout)
  const ontologySnapshot = useCanvas((s) => s.ontologySnapshot)
  const ontologyIsStale = useCanvas((s) => s.ontologyIsStale)

  if (!ontologyLayout || !ontologySnapshot) return null

  const frames = Object.values(ontologyLayout.groupFrames)
  const ot = canvasTokens.ontology

  // LOD: at zoom < 0.15 (dot tier), show only colored regions
  const showLabels = viewport.zoom >= 0.15

  return (
    <div className="te-cv-section-overlay">
      {frames.map((frame) => {
        const group = ontologySnapshot.groupsById[frame.groupId]
        if (!group) return null

        const color =
          ontologyColors[group.colorToken as keyof typeof ontologyColors] ??
          ontologyColors['ontology-green']
        const screenX = frame.x * viewport.zoom + viewport.x
        const screenY = frame.y * viewport.zoom + viewport.y
        const screenW = frame.width * viewport.zoom
        const screenH = frame.height * viewport.zoom

        return (
          <div
            key={frame.groupId}
            className="te-cv-section-region"
            style={{
              left: screenX,
              top: screenY,
              width: screenW,
              height: screenH,
              borderRadius: ot.sectionBorderRadius * viewport.zoom,
              backgroundColor: `${color}${Math.round(
                (frame.isRoot ? ot.sectionFillOpacity : ot.childFillOpacity) * 255
              )
                .toString(16)
                .padStart(2, '0')}`,
              border: `${(frame.isRoot ? 1.5 : 1) * viewport.zoom}px ${frame.isRoot ? 'solid' : 'dashed'} ${color}${Math.round(
                (frame.isRoot ? ot.sectionStrokeOpacity : ot.childStrokeOpacity) * 255
              )
                .toString(16)
                .padStart(2, '0')}`
            }}
          >
            {showLabels && (
              <div
                className="te-cv-section-label"
                data-root={frame.isRoot}
                style={{
                  padding: `${4 * viewport.zoom}px ${8 * viewport.zoom}px`,
                  fontSize: (frame.isRoot ? 13 : 11) * viewport.zoom,
                  color: `${color}cc`,
                  gap: 6 * viewport.zoom
                }}
              >
                {frame.isRoot && (
                  <span
                    className="te-cv-section-dot"
                    style={{
                      width: ot.headerDotRadius * 2 * viewport.zoom,
                      height: ot.headerDotRadius * 2 * viewport.zoom,
                      backgroundColor: `${color}80`
                    }}
                  />
                )}
                <span>{group.label}</span>
                <span className="te-cv-section-count" style={{ fontSize: 10 * viewport.zoom }}>
                  {group.cardIds.length} {group.cardIds.length === 1 ? 'card' : 'cards'}
                  {ontologyIsStale && frame.isRoot && ' · stale'}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
