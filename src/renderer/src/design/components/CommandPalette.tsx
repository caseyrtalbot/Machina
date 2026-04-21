import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { colors, getArtifactColor, typography } from '../tokens'

export interface CommandItem {
  id: string
  label: string
  category: 'note' | 'command' | 'card' | 'search'
  description?: string
  keywords?: readonly string[]
  disabled?: boolean
  shortcut?: string
  folderPath?: string
  artifactType?: string
  matchIndices?: number[]
}

type SearchCallback = (query: string) => CommandItem[]

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  items: ReadonlyArray<CommandItem>
  onSelect: (item: CommandItem) => void
  onSearch?: SearchCallback
}

const CATEGORY_LABELS: Record<CommandItem['category'], string> = {
  note: 'Notes',
  command: 'Actions',
  card: 'Canvas Cards',
  search: 'Body Matches'
}

// eslint-disable-next-line react-refresh/only-export-components
export function fuzzyMatch(
  text: string,
  query: string
): { match: boolean; score: number; indices: number[] } {
  const lower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  if (lower.startsWith(queryLower)) {
    return {
      match: true,
      score: 100,
      indices: Array.from({ length: queryLower.length }, (_, i) => i)
    }
  }

  const substringIdx = lower.indexOf(queryLower)
  if (substringIdx !== -1) {
    return {
      match: true,
      score: 50,
      indices: Array.from({ length: queryLower.length }, (_, i) => substringIdx + i)
    }
  }

  const indices: number[] = []
  let qi = 0
  for (let i = 0; i < lower.length && qi < queryLower.length; i++) {
    if (lower[i] === queryLower[qi]) {
      indices.push(i)
      qi++
    }
  }
  return qi === queryLower.length
    ? { match: true, score: 10, indices }
    : { match: false, score: 0, indices: [] }
}

// eslint-disable-next-line react-refresh/only-export-components
export function filterItems(
  items: ReadonlyArray<CommandItem>,
  query: string
): ReadonlyArray<CommandItem & { matchIndices?: number[] }> {
  if (query === '') return items as ReadonlyArray<CommandItem & { matchIndices?: number[] }>

  const isCommandMode = query.startsWith('>') || query.startsWith('/')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query
  const candidates = isCommandMode ? items.filter((item) => item.category === 'command') : items
  if (searchQuery === '')
    return candidates as ReadonlyArray<CommandItem & { matchIndices?: number[] }>

  return candidates
    .map((item) => {
      const labelResult = fuzzyMatch(item.label, searchQuery)
      const extraFields = [
        item.description,
        item.folderPath,
        item.artifactType,
        ...(item.keywords ?? [])
      ].filter((value): value is string => Boolean(value))
      const extraResult = extraFields
        .map((field) => fuzzyMatch(field, searchQuery))
        .find((result) => result.match)

      if (!labelResult.match && !extraResult?.match) {
        return { ...item, matchIndices: undefined, _match: false, _score: 0 }
      }

      return {
        ...item,
        matchIndices: labelResult.match ? labelResult.indices : undefined,
        _match: true,
        _score: labelResult.match ? labelResult.score + 20 : (extraResult?.score ?? 0)
      }
    })
    .filter((r) => r._match)
    .sort((a, b) => b._score - a._score || a.label.localeCompare(b.label))
    .map(({ _match, _score, ...rest }) => rest)
}

function groupByCategory(
  items: ReadonlyArray<CommandItem>
): ReadonlyArray<{ category: CommandItem['category']; items: ReadonlyArray<CommandItem> }> {
  const categoryOrder: readonly CommandItem['category'][] = ['command', 'card', 'note', 'search']
  return categoryOrder
    .map((category) => ({
      category,
      items: items.filter((item) => item.category === category)
    }))
    .filter((group) => group.items.length > 0)
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

// Thin wrapper: gates rendering on isOpen so inner component mounts fresh each time
export function CommandPalette({ isOpen, ...rest }: CommandPaletteProps) {
  if (!isOpen) return null
  return <CommandPaletteInner {...rest} />
}

// Inner component: owns all state, mounts/unmounts with isOpen
function CommandPaletteInner({
  onClose,
  items,
  onSelect,
  onSearch
}: Omit<CommandPaletteProps, 'isOpen'>) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<ReadonlyArray<CommandItem>>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filtered = useMemo(() => filterItems(items, query), [items, query])

  const allItems = useMemo(() => [...filtered, ...searchResults], [filtered, searchResults])
  const groups = useMemo(() => groupByCategory(allItems), [allItems])

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  const runDebouncedSearch = useCallback(
    (q: string) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (!onSearch || !q.trim() || q.startsWith('>') || q.startsWith('/')) {
        setSearchResults([])
        return
      }
      searchTimerRef.current = setTimeout(() => {
        const results = onSearch(q)
        const currentFiltered = filterItems(items, q)
        const filteredIds = new Set(currentFiltered.map((item) => item.id))
        setSearchResults(results.filter((r) => !filteredIds.has(r.id)))
      }, 150)
    },
    [onSearch, items]
  )

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)
      setSelectedIndex(0)
      runDebouncedSearch(value)
    },
    [runDebouncedSearch]
  )

  const handleSelect = useCallback(
    (item: CommandItem) => {
      if (item.disabled) return
      onSelect(item)
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
        setSelectedIndex((prev) => (prev + 1) % allItems.length || 0)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length || 0)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const item = allItems[selectedIndex]
        if (item) {
          handleSelect(item)
        }
        return
      }
    },
    [allItems, selectedIndex, handleSelect, onClose]
  )

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector('[data-selected="true"]')
    selectedEl?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const groupBaseOffsets = groups.reduce<number[]>((offsets, _group, i) => {
    offsets.push(i === 0 ? 0 : offsets[i - 1] + groups[i - 1].items.length)
    return offsets
  }, [])

  return (
    <div
      data-testid="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] te-cmdk-backdrop"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
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
            placeholder="Search notes or actions... (> for actions)"
            aria-label="Search commands and notes"
            className="w-full bg-transparent outline-none text-sm"
            style={{
              color: colors.text.primary,
              fontFamily: typography.fontFamily.body,
              backgroundColor: colors.bg.surface,
              padding: '8px 12px',
              borderRadius: '8px'
            }}
          />
          <div
            className="mt-2 flex items-center justify-between text-[11px]"
            style={{ color: colors.text.muted }}
          >
            <span>Search titles, body content, tags, and actions.</span>
            <span style={{ fontFamily: typography.fontFamily.mono }}>{'>'} actions</span>
          </div>
        </div>

        <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-2">
          {allItems.length === 0 && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: colors.text.muted }}>
              No results found
            </div>
          )}

          {groups.map((group, groupIndex) => {
            const categoryLabel = CATEGORY_LABELS[group.category]
            const baseOffset = groupBaseOffsets[groupIndex]

            return (
              <div key={group.category}>
                <div
                  className="px-4 py-1.5 text-[11px] tracking-wider uppercase select-none"
                  style={{
                    color: colors.text.muted,
                    fontFamily: typography.fontFamily.body,
                    letterSpacing: typography.metadata.letterSpacing
                  }}
                >
                  {categoryLabel}
                </div>

                {group.items.map((item, itemIndex) => {
                  const currentIndex = baseOffset + itemIndex
                  const isSelected = currentIndex === selectedIndex

                  return (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={item.disabled}
                      data-selected={isSelected}
                      className="w-full px-4 py-2 text-left transition-colors"
                      style={{
                        color: item.disabled ? colors.text.muted : colors.text.primary,
                        backgroundColor: isSelected ? colors.accent.muted : 'transparent',
                        fontFamily: typography.fontFamily.body
                      }}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">
                            <HighlightedLabel label={item.label} indices={item.matchIndices} />
                          </div>
                          {(item.description || item.folderPath) && (
                            <div
                              className="mt-0.5 truncate text-[11px]"
                              style={{ color: colors.text.muted }}
                            >
                              {item.description ?? item.folderPath}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {item.artifactType && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                              style={{
                                color: getArtifactColor(item.artifactType),
                                backgroundColor: `${getArtifactColor(item.artifactType)}14`
                              }}
                            >
                              {item.artifactType}
                            </span>
                          )}
                          {item.shortcut && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                color: colors.text.muted,
                                fontFamily: typography.fontFamily.mono,
                                backgroundColor: colors.bg.surface
                              }}
                            >
                              {item.shortcut}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div
          className="flex items-center justify-between border-t px-4 py-2 text-[11px]"
          style={{ borderColor: colors.border.default, color: colors.text.muted }}
        >
          <span>Enter runs the selected action.</span>
          <span style={{ fontFamily: typography.fontFamily.mono }}>↑ ↓ navigate</span>
        </div>
      </div>
    </div>
  )
}
