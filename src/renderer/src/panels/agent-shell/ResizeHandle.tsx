import { useState } from 'react'

type ResizeHandleSide = 'sidebar' | 'chat'

interface ResizeHandleProps {
  /** Which pane this handle controls. Both handles sit on the right edge of the
   * pane they resize, so dragging right grows the pane in either case. The
   * dock itself has no handle — it flexes to fill whatever width remains. */
  readonly side: ResizeHandleSide
  readonly width: number
  readonly onChange: (next: number) => void
  readonly onCommit: () => void
}

export function ResizeHandle({ side, width, onChange, onCommit }: ResizeHandleProps) {
  const [active, setActive] = useState(false)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const direction = 1
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

  return (
    <div
      data-testid={`resize-handle-${side}`}
      className="resize-handle"
      data-active={active ? 'true' : undefined}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
    >
      <div className="resize-handle__line" aria-hidden />
    </div>
  )
}
