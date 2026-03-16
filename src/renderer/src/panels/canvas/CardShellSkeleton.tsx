import { colors, borderRadius } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

interface CardShellSkeletonProps {
  node: CanvasNode
}

export function CardShellSkeleton({ node }: CardShellSkeletonProps) {
  return (
    <div
      className="absolute flex flex-col animate-pulse"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backgroundColor: colors.bg.surface,
        borderRadius: borderRadius.card,
        border: `1px solid ${colors.border.default}`,
        opacity: 0.6
      }}
    >
      {/* Header skeleton */}
      <div
        className="px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${colors.border.subtle}` }}
      >
        <div
          className="h-3 rounded"
          style={{ width: '60%', backgroundColor: colors.border.subtle }}
        />
      </div>
      {/* Body skeleton */}
      <div className="flex-1 p-3 space-y-2">
        <div className="h-2 rounded" style={{ backgroundColor: colors.border.subtle }} />
        <div
          className="h-2 rounded"
          style={{ width: '80%', backgroundColor: colors.border.subtle }}
        />
        <div
          className="h-2 rounded"
          style={{ width: '60%', backgroundColor: colors.border.subtle }}
        />
      </div>
    </div>
  )
}
