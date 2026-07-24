import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { extractHeadings, findActiveHeading, type HeadingEntry } from './outline-utils'

interface OutlinePanelProps {
  editor: Editor
}

export function OutlinePanel({ editor }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<readonly HeadingEntry[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mutable snapshot of headings for use in event callbacks without re-subscribing
  const headingsRef = useRef<readonly HeadingEntry[]>([])

  // Subscribe to editor updates with debounce
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const refresh = () => {
      if (!editor || editor.isDestroyed) return
      const next = extractHeadings(editor)
      headingsRef.current = next
      setHeadings(next)
      const { from } = editor.state.selection
      setActiveIndex(findActiveHeading(next, from))
    }

    const handleUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(refresh, 100)
    }

    const handleSelectionUpdate = () => {
      const { from } = editor.state.selection
      setActiveIndex(findActiveHeading(headingsRef.current, from))
    }

    // Initial extraction via microtask to avoid synchronous setState in effect
    queueMicrotask(refresh)

    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  const handleClick = useCallback(
    (pos: number) => {
      editor.commands.setTextSelection(pos)
      requestAnimationFrame(() => {
        editor.commands.scrollIntoView()
        editor.commands.focus()
      })
    },
    [editor]
  )

  if (headings.length === 0) {
    return <div className="te-outline-empty">No headings</div>
  }

  // Find minimum heading level to normalize indentation
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <div className="te-outline-scroll scrollbar-hover">
      {/* Console-direction section label: typography.metadata tokens */}
      <div className="te-outline-title">Outline</div>
      <nav>
        {headings.map((heading, i) => {
          const depth = heading.level - minLevel
          const isActive = i === activeIndex

          return (
            <button
              key={`${heading.pos}-${i}`}
              onClick={() => handleClick(heading.pos)}
              className="te-outline-row"
              style={{ '--depth': depth } as React.CSSProperties}
              data-nested={depth > 0 ? 'true' : undefined}
              data-active={isActive ? 'true' : undefined}
              title={heading.text}
            >
              {heading.text || '(empty heading)'}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
