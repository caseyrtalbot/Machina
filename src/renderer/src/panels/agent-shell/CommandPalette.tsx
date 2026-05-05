import { useMemo, useRef, useState } from 'react'
import { colors, borderRadius, typography, zIndex } from '../../design/tokens'
import { useThreadStore } from '../../store/thread-store'
import { buildIndex, buildPaletteItems, searchPalette, type PaletteItem } from './palette-sources'

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  thread: 'thread',
  file: 'file',
  surface: 'surface',
  action: 'action'
}

function PaletteFooterHint({
  label,
  keyLabel
}: {
  readonly label: string
  readonly keyLabel: string
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className="te-kbd">{keyLabel}</span>
      <span>{label}</span>
    </span>
  )
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
        background: colors.scrim.modal,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: zIndex.modal
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--line-default)',
          borderRadius: borderRadius.tool,
          width: 640,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow:
            '0 24px 64px rgba(0, 0, 0, 0.7), 0 4px 12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.02)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--line-subtle)'
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke={colors.text.muted}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find anything · run a command · jump to a note…"
            style={{
              flex: 1,
              padding: 0,
              background: 'transparent',
              color: colors.text.primary,
              border: 'none',
              outline: 'none',
              fontFamily: typography.fontFamily.body,
              fontSize: 15,
              lineHeight: 1.4
            }}
          />
          <span className="te-kbd">esc</span>
        </div>
        <ul
          role="listbox"
          style={{
            margin: 0,
            padding: '6px 0',
            listStyle: 'none',
            overflowY: 'auto',
            flex: 1
          }}
        >
          {results.length === 0 && (
            <li
              style={{
                padding: '10px 18px',
                fontFamily: typography.fontFamily.mono,
                fontSize: 12,
                color: colors.text.muted
              }}
            >
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
                  padding: '8px 18px',
                  background: isActive ? 'var(--bg-tint-accent)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  position: 'relative',
                  borderLeft: `2px solid ${isActive ? 'var(--color-accent-default)' : 'transparent'}`,
                  paddingLeft: isActive ? 16 : 18,
                  transition: 'background 80ms linear'
                }}
              >
                <span
                  style={{
                    fontFamily: typography.fontFamily.mono,
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    color: colors.text.muted,
                    width: 64,
                    flexShrink: 0
                  }}
                >
                  {KIND_LABEL[it.kind]}
                </span>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    flex: 1,
                    gap: 2
                  }}
                >
                  <span
                    style={{
                      color: colors.text.primary,
                      fontSize: 12,
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
                        fontFamily: typography.fontFamily.mono,
                        fontSize: 10,
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '8px 14px',
            borderTop: '1px solid var(--line-subtle)',
            background: 'var(--color-bg-surface)',
            fontFamily: typography.fontFamily.mono,
            fontSize: 11,
            color: colors.text.muted,
            letterSpacing: '0.04em'
          }}
        >
          <PaletteFooterHint label="navigate" keyLabel="↑↓" />
          <PaletteFooterHint label="open" keyLabel="↵" />
          <PaletteFooterHint label="dismiss" keyLabel="esc" />
          <span style={{ flex: 1 }} />
          <span
            className="te-label"
            style={{ color: colors.text.disabled, letterSpacing: '0.12em' }}
          >
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </div>
  )
}
