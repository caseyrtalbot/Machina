import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
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
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{
          color: colors.text.muted,
          fontFamily: typography.fontFamily.mono,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: typography.metadata.letterSpacing
        }}
      >
        No headings
      </div>
    )
  }

  // Find minimum heading level to normalize indentation
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <div className="h-full overflow-y-auto py-2 scrollbar-hover">
      {/* Console-direction section label: typography.metadata tokens */}
      <div
        className="px-3 pb-2"
        style={{
          color: colors.text.muted,
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          fontWeight: 600
        }}
      >
        Outline
      </div>
      <nav>
        {headings.map((heading, i) => {
          const depth = heading.level - minLevel
          const indent = depth * 12
          const isActive = i === activeIndex

          return (
            <button
              key={`${heading.pos}-${i}`}
              onClick={() => handleClick(heading.pos)}
              className="outline-heading-row"
              style={{
                position: 'relative',
                display: 'block',
                width: '100%',
                textAlign: 'left',
                paddingLeft: 12 + indent,
                paddingRight: 12,
                paddingTop: 3,
                paddingBottom: 3,
                fontFamily: typography.fontFamily.mono,
                fontSize: 11,
                lineHeight: '18px',
                color: isActive ? colors.accent.default : colors.text.secondary,
                background: isActive
                  ? 'color-mix(in srgb, var(--color-accent-default) 8%, transparent)'
                  : 'transparent',
                // Hairline indent guide for nested headings: a left border on the
                // button itself, offset to sit just inside the indent column.
                borderLeft:
                  depth > 0 ? `0.5px solid ${colors.border.subtle}` : '0.5px solid transparent',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                cursor: 'pointer',
                borderRadius: borderRadius.card,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: `color ${transitions.focusRing}, background ${transitions.focusRing}`
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = colors.text.primary
                e.currentTarget.style.background =
                  'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = colors.text.secondary
                e.currentTarget.style.background = isActive
                  ? 'color-mix(in srgb, var(--color-accent-default) 8%, transparent)'
                  : 'transparent'
              }}
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
