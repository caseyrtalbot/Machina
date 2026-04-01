import { useCanvasStore } from '../../store/canvas-store'
import { canvasTokens, ontologyColors, typography } from '../../design/tokens'

export function SectionOverlay({
  viewport
}: {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number }
}) {
  const ontologyLayout = useCanvasStore((s) => s.ontologyLayout)
  const ontologySnapshot = useCanvasStore((s) => s.ontologySnapshot)
  const ontologyIsStale = useCanvasStore((s) => s.ontologyIsStale)

  if (!ontologyLayout || !ontologySnapshot) return null

  const frames = Object.values(ontologyLayout.groupFrames)
  const ot = canvasTokens.ontology

  // LOD: at zoom < 0.15 (dot tier), show only colored regions
  const showLabels = viewport.zoom >= 0.15

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 2 }}>
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
            className="absolute"
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
                style={{
                  padding: `${4 * viewport.zoom}px ${8 * viewport.zoom}px`,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: (frame.isRoot ? 13 : 11) * viewport.zoom,
                  fontWeight: frame.isRoot ? 600 : 500,
                  color: `${color}cc`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6 * viewport.zoom,
                  whiteSpace: 'nowrap'
                }}
              >
                {frame.isRoot && (
                  <span
                    style={{
                      width: ot.headerDotRadius * 2 * viewport.zoom,
                      height: ot.headerDotRadius * 2 * viewport.zoom,
                      borderRadius: '50%',
                      backgroundColor: `${color}80`,
                      flexShrink: 0
                    }}
                  />
                )}
                <span>{group.label}</span>
                <span style={{ opacity: 0.4, fontSize: 10 * viewport.zoom }}>
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
