import { useState } from 'react'
import { colors, transitions } from '../../design/tokens'

export type ResizeHandleSide = 'sidebar' | 'dock'

export interface ResizeHandleProps {
  /** Which pane this handle controls. `sidebar` lives to the right of the sidebar
   * (drag right grows the sidebar); `dock` lives to the left of the dock (drag
   * right shrinks the dock). */
  readonly side: ResizeHandleSide
  readonly width: number
  readonly onChange: (next: number) => void
  readonly onCommit: () => void
}

export function ResizeHandle({ side, width, onChange, onCommit }: ResizeHandleProps) {
  const [active, setActive] = useState(false)
  const [hovered, setHovered] = useState(false)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const direction = side === 'sidebar' ? 1 : -1
    setActive(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      const next = startWidth + direction * (ev.clientX - startX)
      onChange(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setActive(false)
      onCommit()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const showAccent = active || hovered
  return (
    <div
      data-testid={`resize-handle-${side}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        width: 4,
        position: 'relative',
        cursor: 'col-resize',
        background: 'transparent'
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 1,
          width: 1,
          background: showAccent ? colors.accent.muted : colors.border.default,
          transition: `background ${transitions.fast}`
        }}
      />
    </div>
  )
}
