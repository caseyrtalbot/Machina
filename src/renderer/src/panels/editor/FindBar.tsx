import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { findPluginKey, type FindPluginMeta } from './extensions/find-in-note'

interface FindBarProps {
  editor: Editor
  /** Bumped on each Cmd+F so an already-open bar refocuses its input. */
  focusSignal: number
  onClose: () => void
}

export function FindBar({ editor, focusSignal, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState({ total: 0, active: 0 })

  const dispatchFind = useCallback(
    (meta: FindPluginMeta) => {
      if (editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, meta))
      const state = findPluginKey.getState(editor.state)
      if (state && state.matches.length > 0) {
        const match = state.matches[state.activeIndex]
        const dom = editor.view.domAtPos(match.from)
        const el = dom.node instanceof Element ? dom.node : dom.node.parentElement
        el?.scrollIntoView({ block: 'center' })
      }
    },
    [editor]
  )

  // Mirror plugin state (count + active index) into React, including when
  // matches shift because the document itself changed.
  useEffect(() => {
    const update = () => {
      const state = findPluginKey.getState(editor.state)
      setCounts({ total: state?.matches.length ?? 0, active: state?.activeIndex ?? 0 })
    }
    update()
    editor.on('transaction', update)
    return () => {
      editor.off('transaction', update)
    }
  }, [editor])

  // Focus (and reselect) the input on mount and on every repeat Cmd+F.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  // Unmount = closed (Escape, mode switch, note change): clear all highlights.
  useEffect(() => {
    return () => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { query: '', activeIndex: 0 }))
      }
    }
  }, [editor])

  const step = useCallback(
    (direction: 1 | -1) => {
      const state = findPluginKey.getState(editor.state)
      if (!state || state.matches.length === 0) return
      const total = state.matches.length
      dispatchFind({
        query: state.query,
        activeIndex: (state.activeIndex + direction + total) % total
      })
    },
    [editor, dispatchFind]
  )

  const handleClose = useCallback(() => {
    onClose()
    if (!editor.isDestroyed) editor.commands.focus()
  }, [onClose, editor])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      }
    },
    [handleClose, step]
  )

  return (
    <div className="te-findbar">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find"
        aria-label="Find in note"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          dispatchFind({ query: e.target.value, activeIndex: 0 })
        }}
        onKeyDown={handleKeyDown}
        className="te-findbar-input"
      />
      <span className="te-findbar-count" data-empty={Boolean(query) && counts.total === 0}>
        {counts.total > 0 ? `${counts.active + 1}/${counts.total}` : '0/0'}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous match (⇧↩)"
        className="te-findbar-btn"
        onClick={() => step(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next match (↩)"
        className="te-findbar-btn"
        onClick={() => step(1)}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label="Close find bar"
        title="Close (Esc)"
        className="te-findbar-btn"
        onClick={handleClose}
      >
        ✕
      </button>
    </div>
  )
}
