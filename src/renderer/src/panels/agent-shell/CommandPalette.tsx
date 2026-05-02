import { useMemo, useRef, useState } from 'react'
import { colors, borderRadius } from '../../design/tokens'
import { useThreadStore } from '../../store/thread-store'
import { buildIndex, buildPaletteItems, searchPalette, type PaletteItem } from './palette-sources'

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  thread: 'thread',
  file: 'file',
  surface: 'surface',
  action: 'action'
}

export function CommandPalette({
  open,
  onClose
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevQ, setPrevQ] = useState(q)
  const inputRef = useRef<HTMLInputElement>(null)
  const createThread = useThreadStore((s) => s.createThread)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setQ('')
      setActive(0)
    }
  }
  if (q !== prevQ) {
    setPrevQ(q)
    setActive(0)
  }

  const items = useMemo(
    () => (open ? buildPaletteItems({ closePalette: onClose }) : []),
    [open, onClose]
  )
  const index = useMemo(() => (open ? buildIndex(items) : null), [open, items])
  const results = useMemo(() => (index ? searchPalette(index, items, q) : []), [index, items, q])

  if (!open) return null

  const trimmedQuery = q.trim()
  const canCreateThread = results.length === 0 && trimmedQuery.length > 0

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = results[active]
      if (it) {
        void it.run()
      } else if (canCreateThread) {
        const title = trimmedQuery
        onClose()
        void createThread('machina-native', 'claude-sonnet-4-6', title)
      }
    }
  }

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
          padding: 12,
          width: 520,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search threads, files, surfaces, actions…"
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
        <ul
          role="listbox"
          style={{
            margin: '8px 0 0 0',
            padding: 0,
            listStyle: 'none',
            overflowY: 'auto',
            flex: 1
          }}
        >
          {results.length === 0 && (
            <li style={{ padding: 8, fontSize: 12, color: colors.text.muted }}>
              {canCreateThread
                ? `No matches. Press Enter to create a new thread named "${trimmedQuery}".`
                : 'Start typing to search.'}
            </li>
          )}
          {results.map((it, i) => {
            const isActive = i === active
            return (
              <li
                key={it.id}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => void it.run()}
                style={{
                  padding: '6px 8px',
                  borderRadius: borderRadius.inline,
                  background: isActive ? colors.bg.base : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    color: colors.text.muted,
                    minWidth: 56
                  }}
                >
                  {KIND_LABEL[it.kind]}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      color: colors.text.primary,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {it.title}
                  </span>
                  {it.subtitle && (
                    <span
                      style={{
                        color: colors.text.muted,
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {it.subtitle}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
