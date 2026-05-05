import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { colors } from '../../design/tokens'

interface FolderMapPreviewProps {
  readonly plan: CanvasMutationPlan
  readonly onApply: () => void
  readonly onCancel: () => void
}

/**
 * Ghost SVG overlay showing where nodes/edges will be placed.
 * Render inside CanvasSurface (canvas-space coordinates).
 */
export function FolderMapPreviewGhosts({ plan }: { readonly plan: CanvasMutationPlan }) {
  const addNodeOps = plan.ops.filter((op) => op.type === 'add-node')
  const addEdgeOps = plan.ops.filter((op) => op.type === 'add-edge')

  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const op of addNodeOps) {
    if (op.type === 'add-node') {
      nodePositions.set(op.node.id, {
        x: op.node.position.x,
        y: op.node.position.y,
        width: op.node.size.width,
        height: op.node.size.height
      })
    }
  }

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none'
      }}
    >
      {addEdgeOps.map((op) => {
        if (op.type !== 'add-edge') return null
        const from = nodePositions.get(op.edge.fromNode)
        const to = nodePositions.get(op.edge.toNode)
        if (!from || !to) return null
        const x1 = from.x + from.width / 2
        const y1 = from.y + from.height / 2
        const x2 = to.x + to.width / 2
        const y2 = to.y + to.height / 2
        return (
          <line
            key={op.edge.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={colors.text.muted}
            strokeWidth={1}
            strokeOpacity={0.3}
          />
        )
      })}

      {addNodeOps.map((op) => {
        if (op.type !== 'add-node') return null
        const { x, y } = op.node.position
        const { width, height } = op.node.size
        const name =
          (op.node.metadata.relativePath as string) ?? op.node.content?.split('/').pop() ?? ''
        return (
          <g key={op.node.id}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={6}
              fill={colors.bg.elevated}
              fillOpacity={0.15}
              stroke={colors.accent.default}
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeOpacity={0.5}
            />
            <text
              x={x + width / 2}
              y={y + height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={colors.text.secondary}
              fontSize={11}
              opacity={0.7}
            >
              {name.length > 30 ? `\u2026${name.slice(-28)}` : name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Fixed confirmation pill with Apply/Cancel.
 * Render OUTSIDE CanvasSurface (viewport-anchored, not canvas-space).
 */
export function FolderMapPreviewBar({ plan, onApply, onCancel }: FolderMapPreviewProps) {
  const addNodeOps = plan.ops.filter((op) => op.type === 'add-node')
  const addEdgeOps = plan.ops.filter((op) => op.type === 'add-edge')

  const folderCount = addNodeOps.filter(
    (op) => op.type === 'add-node' && op.node.type === 'project-folder'
  ).length
  const fileCount = addNodeOps.length - folderCount
  const edgeCount = addEdgeOps.length

  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 20px',
        borderRadius: '10px',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        backdropFilter: 'blur(12px)',
        fontSize: '13px',
        color: 'var(--color-text-secondary)',
        zIndex: 100,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      }}
    >
      <span>
        Map {addNodeOps.length} items &mdash; {folderCount} folders, {fileCount} files, {edgeCount}{' '}
        links
        {plan.summary.skippedFiles > 0 && `. ${plan.summary.skippedFiles} skipped`}
      </span>
      <button
        onClick={onApply}
        style={{
          padding: '4px 14px',
          borderRadius: '6px',
          border: 'none',
          background: 'var(--color-accent-default)',
          color: 'var(--color-text-on-accent)',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        Apply
      </button>
      <button
        onClick={onCancel}
        style={{
          padding: '4px 14px',
          borderRadius: '6px',
          border: '1px solid var(--color-border-subtle)',
          background: 'transparent',
          color: 'var(--color-text-secondary)',
          fontSize: '13px',
          cursor: 'pointer'
        }}
      >
        Cancel
      </button>
    </div>
  )
}
