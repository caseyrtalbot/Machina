import type { CanvasNode } from '@shared/canvas-types'

interface CardShellSkeletonProps {
  node: CanvasNode
}

export function CardShellSkeleton({ node }: CardShellSkeletonProps) {
  return (
    <div
      className="canvas-card-skeleton"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height
      }}
    >
      {/* Header skeleton */}
      <div className="canvas-card-skeleton__header">
        <div className="canvas-card-skeleton__header-bar" />
      </div>
      {/* Body skeleton */}
      <div className="canvas-card-skeleton__body">
        <div className="canvas-card-skeleton__line" />
        <div className="canvas-card-skeleton__line canvas-card-skeleton__line--80" />
        <div className="canvas-card-skeleton__line canvas-card-skeleton__line--60" />
      </div>
    </div>
  )
}
