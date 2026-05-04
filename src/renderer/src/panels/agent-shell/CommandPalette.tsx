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
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span
        style={{
          padding: '1px 5px',
          background: 'transparent',
          border: `1px solid ${colors.border.default}`,
          borderRadius: borderRadius.inline,
          fontSize: 10,
          color: colors.text.muted
        }}
      >
        {keyLabel}
      </span>
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
          background: colors.bg.elevated,
          border: `1px solid ${colors.border.strong}`,
          borderRadius: borderRadius.tool,
          width: 560,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow:
            '0 24px 48px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, var(--color-accent-default) 18%, transparent)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.border.subtle}`
          }}
        >
          <span
            aria-hidden
            style={{
              color: colors.accent.default,
              fontFamily: typography.fontFamily.mono,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1
            }}
          >
            ❯
          </span>
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search threads, files, surfaces, actions…"
            style={{
              flex: 1,
              padding: 0,
              background: 'transparent',
              color: colors.text.primary,
              border: 'none',
              outline: 'none',
              fontFamily: typography.fontFamily.mono,
              fontSize: 14,
              lineHeight: 1.4
            }}
          />
          <span
            style={{
              fontFamily: typography.fontFamily.mono,
              fontSize: 10,
              color: colors.text.muted,
              letterSpacing: '0.05em'
            }}
          >
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
          <span
            style={{
              padding: '2px 6px',
              background: 'transparent',
              border: `1px solid ${colors.border.default}`,
              borderRadius: borderRadius.inline,
              fontFamily: typography.fontFamily.mono,
              fontSize: 10,
              color: colors.text.muted
            }}
          >
            esc
          </span>
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
                  background: isActive ? colors.bg.surface : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  position: 'relative',
                  borderLeft: `2px solid ${isActive ? colors.accent.default : 'transparent'}`,
                  paddingLeft: isActive ? 16 : 18
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
            gap: 14,
            padding: '8px 18px',
            borderTop: `1px solid ${colors.border.subtle}`,
            background: colors.bg.base,
            fontFamily: typography.fontFamily.mono,
            fontSize: 10,
            color: colors.text.disabled
          }}
        >
          <PaletteFooterHint label="navigate" keyLabel="↑↓" />
          <PaletteFooterHint label="open" keyLabel="↵" />
          <PaletteFooterHint label="dismiss" keyLabel="esc" />
        </div>
      </div>
    </div>
  )
}
