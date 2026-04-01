import { useCallback, useRef, useState } from 'react'
import { CanvasSplitEditor } from './CanvasSplitEditor'

/** Draggable divider + editor panel. Separate component to isolate drag
 *  state from CanvasView and prevent canvas DOM remounts. */
export function SplitDividerAndPanel({ filePath }: { readonly filePath: string }) {
  const [width, setWidth] = useState(480)
  const dragging = useRef(false)

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const fromRight = window.innerWidth - e.clientX
      setWidth(Math.max(250, Math.min(fromRight, window.innerWidth - 500)))
    }

    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <>
      <div className="panel-divider" onMouseDown={handleMouseDown} />
      <div style={{ width, flexShrink: 0 }} className="h-full overflow-hidden">
        <CanvasSplitEditor filePath={filePath} />
      </div>
    </>
  )
}
