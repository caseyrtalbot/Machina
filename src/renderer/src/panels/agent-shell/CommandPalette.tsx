import { useEffect, useMemo, useRef, useState } from 'react'
import { colors } from '../../design/tokens'
import { Modal } from '../../components/overlay/Modal'
import { useThreadStore } from '../../store/thread-store'
import { useHarnessStore } from '../../store/harness-store'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { searchVault } from '../../engine/vault-search'
import type { SearchHit } from '@shared/engine/search-engine'
import type { AgentCommits } from '@shared/git-types'
import type { HarnessSummary } from '@shared/harness-types'
import {
  buildIndex,
  buildPaletteItems,
  noteHitItems,
  searchPalette,
  type PaletteItem
} from './palette-sources'

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  thread: 'thread',
  file: 'file',
  surface: 'surface',
  action: 'action',
  note: 'note'
}

const FULLTEXT_DEBOUNCE_MS = 150
const FULLTEXT_LIMIT = 8

function PaletteFooterHint({
  label,
  keyLabel
}: {
  readonly label: string
  readonly keyLabel: string
}) {
  return (
    <span className="te-palette-hint">
      <span className="te-kbd">{keyLabel}</span>
      <span>{label}</span>
    </span>
  )
}

export function CommandPalette({
  open,
  onClose,
  onOpenHarnessGallery,
  onOpenHarnessTaskBrief
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly onOpenHarnessGallery?: (templateId?: string) => void
  readonly onOpenHarnessTaskBrief?: (summary: HarnessSummary) => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevQ, setPrevQ] = useState(q)
  const inputRef = useRef<HTMLInputElement>(null)
  const createThread = useThreadStore((s) => s.createThread)
  const harnessSummaries = useHarnessStore((s) => s.summaries)

  // Refresh harness summaries on palette open (workstation step 6): the item
  // list below subscribes to the store, so a completed refresh re-renders the
  // open palette with the current on-disk harnesses.
  useEffect(() => {
    if (open) void useHarnessStore.getState().refresh()
  }, [open])

  // Per-agent revert snapshot, refreshed on palette open (workstation step 5):
  // revert entries are gated on a non-empty unreverted-commit list. Errors
  // (no workspace, non-repo, no bridge in tests) just mean no entries.
  const [agentCommits, setAgentCommits] = useState<readonly AgentCommits[]>([])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await window.api.git.listAgentCommits()
        if (!cancelled) setAgentCommits(res.ok ? res.agents : [])
      } catch {
        if (!cancelled) setAgentCommits([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

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
    () =>
      open
        ? buildPaletteItems({
            closePalette: onClose,
            openHarnessGallery: onOpenHarnessGallery,
            openHarnessTaskBrief: onOpenHarnessTaskBrief,
            harnesses: harnessSummaries,
            agentCommits
          })
        : [],
    [open, onClose, onOpenHarnessGallery, onOpenHarnessTaskBrief, harnessSummaries, agentCommits]
  )
  const index = useMemo(() => (open ? buildIndex(items) : null), [open, items])

  // Full-text body search (vault-worker SearchEngine), debounced off the
  // synchronous palette index so typing stays instant.
  const [noteHits, setNoteHits] = useState<readonly SearchHit[]>([])
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (!open || !q.trim()) {
        setNoteHits([])
        return
      }
      void searchVault(q, FULLTEXT_LIMIT).then((hits) => {
        if (!cancelled) setNoteHits(hits)
      })
    }, FULLTEXT_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, q])

  const results = useMemo(() => {
    const base = index ? searchPalette(index, items, q) : []
    if (!q.trim() || noteHits.length === 0) return base
    const shownIds = new Set(base.map((it) => it.id))
    return [...base, ...noteHitItems(noteHits, shownIds, { closePalette: onClose })]
  }, [index, items, q, noteHits, onClose])

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
        void createThread('machina-native', DEFAULT_NATIVE_MODEL, title)
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="top"
      topOffset="12vh"
      scrimBlur="blur(4px)"
      ariaLabel="command palette"
      panelClassName="te-palette-panel"
    >
      <div className="te-palette-search">
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
          className="te-palette-input"
        />
        <span className="te-kbd">esc</span>
      </div>
      <ul role="listbox" className="te-palette-list">
        {results.length === 0 && (
          <li className="te-palette-empty">
            {canCreateThread
              ? `No matches. Press Enter to create a new thread named "${trimmedQuery}".`
              : 'Start typing to search.'}
          </li>
        )}
        {results.map((it, i) => {
          const isActive = i === active
          // Disabled items (step-7 linter: broken harnesses) render greyed
          // with their reason; run() is a no-op so click/Enter do nothing.
          const isDisabled = it.disabledReason !== undefined
          return (
            <li
              key={it.id}
              role="option"
              aria-selected={isActive}
              aria-disabled={isDisabled || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => void it.run()}
              className="te-palette-option"
            >
              <span className="te-palette-kind">{KIND_LABEL[it.kind]}</span>
              <div className="te-palette-text">
                <span className="te-palette-title">{it.title}</span>
                {it.subtitle && <span className="te-palette-subtitle">{it.subtitle}</span>}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="te-palette-footer">
        <PaletteFooterHint label="navigate" keyLabel="↑↓" />
        <PaletteFooterHint label="open" keyLabel="↵" />
        <PaletteFooterHint label="dismiss" keyLabel="esc" />
        <span className="te-palette-spacer" />
        <span className="te-label te-palette-count">
          {results.length} {results.length === 1 ? 'result' : 'results'}
        </span>
      </div>
    </Modal>
  )
}
