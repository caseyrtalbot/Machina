import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  initialLeftWidth: number
  minLeftWidth: number
  minRightWidth: number
  onResize?: (leftWidth: number) => void
}

export function SplitPane({
  left,
  right,
  initialLeftWidth,
  minLeftWidth,
  minRightWidth,
  onResize
}: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // Re-clamp left width whenever the container resizes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (dragging.current) return
      const totalWidth = el.clientWidth
      const dividerWidth = 1
      const maxLeft = totalWidth - dividerWidth - minRightWidth
      setLeftWidth((prev) => {
        if (prev > maxLeft) {
          const clamped = Math.max(minLeftWidth, maxLeft)
          onResize?.(clamped)
          return clamped
        }
        return prev
      })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [minLeftWidth, minRightWidth, onResize])

  useEffect(() => {
    return () => {
      if (handlersRef.current.move)
        document.removeEventListener('mousemove', handlersRef.current.move)
      if (handlersRef.current.up) document.removeEventListener('mouseup', handlersRef.current.up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newLeft = Math.max(
        minLeftWidth,
        Math.min(e.clientX - rect.left, rect.width - minRightWidth)
      )
      setLeftWidth(newLeft)
      onResize?.(newLeft)
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      handlersRef.current = { move: null, up: null }
    }

    handlersRef.current = { move: handleMouseMove, up: handleMouseUp }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [minLeftWidth, minRightWidth, onResize])

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div style={{ width: leftWidth, flexShrink: 0 }} className="overflow-hidden">
        {left}
      </div>
      <div onMouseDown={handleMouseDown} className="panel-divider" />
      <div className="flex-1 overflow-hidden">{right}</div>
    </div>
  )
}
