import { memo } from 'react'
import { colors } from '../../design/tokens'

interface ClusterCaptureButtonProps {
  readonly clusterId: string | null
  readonly hasMembers: boolean
  readonly onCapture: () => void
}

function ClusterCaptureButtonComponent({
  clusterId,
  hasMembers,
  onCapture
}: ClusterCaptureButtonProps) {
  if (!clusterId || !hasMembers) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onCapture()
      }}
      className="inline-flex items-center text-xs"
      style={{
        color: colors.text.secondary,
        background: 'transparent',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 4,
        padding: '1px 6px',
        cursor: 'pointer'
      }}
      title="Capture this cluster as a single note"
    >
      Keep as note
    </button>
  )
}

export const ClusterCaptureButton = memo(ClusterCaptureButtonComponent)
