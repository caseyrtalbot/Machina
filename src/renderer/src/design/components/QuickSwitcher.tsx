import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { colors, getArtifactColor, typography, zIndex } from '../tokens'
import { fuzzyMatch } from './CommandPalette'

export interface QuickSwitcherItem {
  readonly path: string
  readonly title: string
  readonly relativePath: string
  readonly folderPath?: string
  readonly artifactType?: string
}

interface QuickSwitcherProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly items: ReadonlyArray<QuickSwitcherItem>
  readonly recentPaths: ReadonlyArray<string>
  readonly bookmarkedPaths: ReadonlyArray<string>
  readonly openTabPaths: ReadonlyArray<string>
  readonly onSelect: (path: string) => void
}

interface ScoredItem extends QuickSwitcherItem {
  readonly matchIndices?: number[]
  readonly _score: number
}

function priorityScore(
  path: string,
  recentPaths: ReadonlyArray<string>,
  bookmarkedPaths: ReadonlyArray<string>,
  openTabPaths: ReadonlyArray<string>
): number {
  // Lower index = more recent, higher priority score
  const recentIdx = recentPaths.indexOf(path)
  const isBookmarked = bookmarkedPaths.includes(path)
  const isOpenTab = openTabPaths.includes(path)

  let score = 0
  if (recentIdx !== -1) score += 1000 - recentIdx
  if (isBookmarked) score += 500
  if (isOpenTab) score += 300
  return score
}

function filterAndScore(
  items: ReadonlyArray<QuickSwitcherItem>,
  query: string,
  recentPaths: ReadonlyArray<string>,
  bookmarkedPaths: ReadonlyArray<string>,
  openTabPaths: ReadonlyArray<string>
): ReadonlyArray<ScoredItem> {
  if (query === '') {
    // Empty query: sort by priority (recent → bookmarked → open tabs → rest), then alpha
    return [...items]
      .map((item) => ({
        ...item,
        _score: priorityScore(item.path, recentPaths, bookmarkedPaths, openTabPaths)
      }))
      .sort((a, b) => b._score - a._score || a.title.localeCompare(b.title))
  }

  return items
    .map((item) => {
      const titleResult = fuzzyMatch(item.title, query)
      const extraFields = [item.relativePath, item.folderPath, item.artifactType].filter(
        (v): v is string => Boolean(v)
      )
      const extraResult = extraFields.map((f) => fuzzyMatch(f, query)).find((r) => r.match)

      if (!titleResult.match && !extraResult?.match) {
        return { ...item, matchIndices: undefined, _score: -1 }
      }

      const fuzzyScore = titleResult.match ? titleResult.score + 20 : (extraResult?.score ?? 0)
      const priority = priorityScore(item.path, recentPaths, bookmarkedPaths, openTabPaths)
      return {
        ...item,
        matchIndices: titleResult.match ? titleResult.indices : undefined,
        _score: fuzzyScore * 100 + priority
      }
    })
    .filter((r) => r._score >= 0)
    .sort((a, b) => b._score - a._score || a.title.localeCompare(b.title))
}

function HighlightedLabel({ label, indices }: { label: string; indices?: number[] }) {
  if (!indices || indices.length === 0) return <span>{label}</span>
  const indexSet = new Set(indices)
  return (
    <span>
      {label.split('').map((char, i) => (
        <span
          key={i}
          style={indexSet.has(i) ? { color: colors.accent.default, fontWeight: 600 } : undefined}
        >
          {char}
        </span>
      ))}
    </span>
  )
}

export function QuickSwitcher({ isOpen, ...rest }: QuickSwitcherProps) {
  if (!isOpen) return null
  return <QuickSwitcherInner {...rest} />
}

function QuickSwitcherInner({
  onClose,
  items,
  recentPaths,
  bookmarkedPaths,
  openTabPaths,
  onSelect
}: Omit<QuickSwitcherProps, 'isOpen'>) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(
    () => filterAndScore(items, query, recentPaths, bookmarkedPaths, openTabPaths),
    [items, query, recentPaths, bookmarkedPaths, openTabPaths]
  )

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const handleSelect = useCallback(
    (item: ScoredItem) => {
      onSelect(item.path)
      onClose()
    },
    [onSelect, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) =>
          filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
        )
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[selectedIndex]
        if (item) handleSelect(item)
        return
      }
    },
    [filtered, selectedIndex, handleSelect, onClose]
  )

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setSelectedIndex(0)
  }, [])

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector('[data-selected="true"]')
    selectedEl?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div
      data-testid="quick-switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Quick switcher"
      className="fixed inset-0 flex items-start justify-center pt-[20vh] te-cmdk-backdrop"
      style={{ backgroundColor: colors.scrim.modal, zIndex: zIndex.modal }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden te-popover-enter"
        style={{
          backgroundColor: colors.bg.elevated,
          borderColor: colors.border.default
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: colors.border.default }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Jump to note..."
            aria-label="Search notes"
            className="w-full bg-transparent outline-none text-sm"
            style={{
              color: colors.text.primary,
              fontFamily: typography.fontFamily.body,
              backgroundColor: colors.bg.surface,
              padding: '8px 12px',
              borderRadius: '8px'
            }}
          />
        </div>

        <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: colors.text.muted }}>
              No matching notes
            </div>
          )}

          {filtered.map((item, i) => {
            const isSelected = i === selectedIndex

            return (
              <button
                key={item.path}
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected}
                className="w-full px-4 py-2 text-left transition-colors"
                style={{
                  color: colors.text.primary,
                  backgroundColor: isSelected ? colors.accent.muted : 'transparent',
                  fontFamily: typography.fontFamily.body
                }}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      <HighlightedLabel label={item.title} indices={item.matchIndices} />
                    </div>
                    {item.relativePath && (
                      <div
                        className="mt-0.5 truncate text-[11px]"
                        style={{ color: colors.text.muted }}
                      >
                        {item.relativePath}
                      </div>
                    )}
                  </div>
                  {item.artifactType && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] shrink-0"
                      style={{
                        color: getArtifactColor(item.artifactType),
                        backgroundColor: `${getArtifactColor(item.artifactType)}14`
                      }}
                    >
                      {item.artifactType}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div
          className="flex items-center justify-between border-t px-4 py-2 text-[11px]"
          style={{ borderColor: colors.border.default, color: colors.text.muted }}
        >
          <span>Enter opens selected note.</span>
          <span style={{ fontFamily: typography.fontFamily.mono }}>⌘O</span>
        </div>
      </div>
    </div>
  )
}
