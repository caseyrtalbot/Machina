import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { typography, colors, transitions } from '../../../design/tokens'

export interface SlashCommandItem {
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly command: (props: { editor: Editor; range: Range }) => void
}

interface SlashCommandListProps {
  readonly items: readonly SlashCommandItem[]
  readonly command: (item: SlashCommandItem) => void
}

export function SlashCommandList({ items, command }: SlashCommandListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const [prevItems, setPrevItems] = useState(items)

  // Reset selection when items change (React docs: "adjusting state during rendering")
  if (prevItems !== items) {
    setPrevItems(items)
    if (selectedIndex !== 0) setSelectedIndex(0)
  }

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const onKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
        return true
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1))
        return true
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (items[selectedIndex]) {
          command(items[selectedIndex])
        }
        return true
      }
      return false
    },
    [items, selectedIndex, command]
  )

  // Expose onKeyDown to parent via ref-like pattern
  useEffect(() => {
    ;(SlashCommandList as unknown as { onKeyDown?: (e: KeyboardEvent) => boolean }).onKeyDown =
      onKeyDown
    return () => {
      ;(SlashCommandList as unknown as { onKeyDown?: undefined }).onKeyDown = undefined
    }
  }, [onKeyDown])

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '12px 16px',
          color: colors.text.muted,
          fontSize: 12,
          fontFamily: typography.fontFamily.mono
        }}
      >
        No matching commands
      </div>
    )
  }

  return (
    <div ref={listRef} className="flex flex-col py-1" style={{ maxHeight: 280, overflowY: 'auto' }}>
      {items.map((item, index) => (
        <button
          key={item.title}
          className="flex items-center gap-3 text-left"
          style={{
            padding: '8px 12px',
            backgroundColor: index === selectedIndex ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: colors.text.primary,
            transition: `background-color ${transitions.focusRing}`
          }}
          onClick={() => command(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              fontSize: 14,
              flexShrink: 0
            }}
          >
            {item.icon}
          </span>
          <span className="flex flex-col min-w-0">
            <span
              style={{
                fontSize: 13,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.primary
              }}
            >
              {item.title}
            </span>
            <span
              style={{
                fontSize: 11,
                color: colors.text.muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
