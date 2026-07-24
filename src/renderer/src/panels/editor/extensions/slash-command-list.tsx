import { useState, useEffect, useCallback, useRef, useImperativeHandle, type Ref } from 'react'
import type { Editor, Range } from '@tiptap/core'

export interface SlashCommandItem {
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly command: (props: { editor: Editor; range: Range }) => void
}

/** Imperative handle for the suggestion plugin to forward keyboard events. */
export interface SlashCommandListHandle {
  readonly onKeyDown: (e: KeyboardEvent) => boolean
}

interface SlashCommandListProps {
  readonly items: readonly SlashCommandItem[]
  readonly command: (item: SlashCommandItem) => void
  readonly ref?: Ref<SlashCommandListHandle>
}

export function SlashCommandList({ items, command, ref }: SlashCommandListProps) {
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

  // Expose onKeyDown to the suggestion plugin via an imperative handle
  useImperativeHandle(ref, () => ({ onKeyDown }), [onKeyDown])

  if (items.length === 0) {
    return <div className="te-slashmenu-empty">No matching commands</div>
  }

  return (
    <div ref={listRef} className="te-slashmenu-list">
      {items.map((item, index) => (
        <button
          key={item.title}
          className="te-slashmenu-item"
          data-selected={index === selectedIndex}
          onClick={() => command(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="te-slashmenu-icon">{item.icon}</span>
          <span className="te-slashmenu-text">
            <span className="te-slashmenu-title">{item.title}</span>
            <span className="te-slashmenu-desc">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
