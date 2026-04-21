import { useState } from 'react'
import { colors } from '../../design/tokens'

interface ClusterTitleDialogProps {
  readonly open: boolean
  readonly defaultTitle?: string
  readonly onConfirm: (title: string) => void
  readonly onCancel: () => void
}

export function ClusterTitleDialog({
  open,
  defaultTitle,
  onConfirm,
  onCancel
}: ClusterTitleDialogProps) {
  const [title, setTitle] = useState(defaultTitle ?? '')
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cluster-title-dialog-title"
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-96 flex-col gap-3 p-4"
        style={{
          backgroundColor: colors.bg.elevated,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 6
        }}
      >
        <label
          id="cluster-title-dialog-title"
          className="text-sm"
          style={{ color: colors.text.primary }}
        >
          Title for this cluster
        </label>
        <input
          autoFocus
          className="px-2 py-1 text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) onConfirm(title.trim())
            if (e.key === 'Escape') onCancel()
          }}
          style={{
            backgroundColor: colors.bg.base,
            color: colors.text.primary,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 4
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 text-sm"
            style={{ color: colors.text.muted, background: 'transparent' }}
          >
            Cancel
          </button>
          <button
            onClick={() => title.trim() && onConfirm(title.trim())}
            disabled={!title.trim()}
            className="px-3 py-1 text-sm"
            style={{
              backgroundColor: colors.accent.default,
              color: colors.bg.base,
              opacity: title.trim() ? 1 : 0.5,
              borderRadius: 4
            }}
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  )
}
