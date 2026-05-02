import { useState } from 'react'
import { colors, borderRadius } from '../../design/tokens'

export function CommandPalette({
  open,
  onClose
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [q, setQ] = useState('')
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-label="command palette"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 100
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`,
          borderRadius: borderRadius.container,
          padding: 16,
          width: 480
        }}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search threads, files, canvases…"
          style={{
            width: '100%',
            padding: 8,
            background: colors.bg.base,
            color: colors.text.primary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: borderRadius.inline,
            outline: 'none'
          }}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: colors.text.muted }}>
          Phase 5 stub. Phase 6 wires palette sources.
        </div>
      </div>
    </div>
  )
}
