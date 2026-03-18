import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { colors, typography } from '../tokens'

export interface CommandItem {
  id: string
  label: string
  category: 'note' | 'command'
  shortcut?: string
  folderPath?: string
  artifactType?: string
  matchIndices?: number[]
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  items: ReadonlyArray<CommandItem>
  onSelect: (item: CommandItem) => void
}

const CATEGORY_LABELS: Record<CommandItem['category'], string> = {
  note: 'Notes',
  command: 'Commands'
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
      const result = fuzzyMatch(item.label, searchQuery)
      return { ...item, matchIndices: result.indices, _match: result.match, _score: result.score }
    })
    .filter((r) => r._match)
    .sort((a, b) => b._score - a._score)
    .map(({ _match, _score, ...rest }) => rest)
}

function groupByCategory(
  items: ReadonlyArray<CommandItem>
): ReadonlyArray<{ category: CommandItem['category']; items: ReadonlyArray<CommandItem> }> {
  const groups = new Map<CommandItem['category'], CommandItem[]>()

  for (const item of items) {
    const existing = groups.get(item.category)
    if (existing) {
      existing.push(item)
    } else {
      groups.set(item.category, [item])
    }
  }

  return Array.from(groups.entries()).map(([category, categoryItems]) => ({
    category,
    items: categoryItems
  }))
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
function CommandPaletteInner({ onClose, items, onSelect }: Omit<CommandPaletteProps, 'isOpen'>) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterItems(items, query), [items, query])
  const groups = useMemo(() => groupByCategory(filtered), [filtered])

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setSelectedIndex(0)
  }, [])

  const handleSelect = useCallback(
    (item: CommandItem) => {
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
        setSelectedIndex((prev) => (prev + 1) % filtered.length || 0)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length || 0)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[selectedIndex]
        if (item) {
          handleSelect(item)
        }
        return
      }
    },
    [filtered, selectedIndex, handleSelect, onClose]
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
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
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
            placeholder="Search notes... (> for commands)"
            aria-label="Command palette"
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
                      data-selected={isSelected}
                      className="w-full flex items-center justify-between px-4 py-2 text-sm text-left transition-colors"
                      style={{
                        color: colors.text.primary,
                        backgroundColor: isSelected ? colors.accent.muted : 'transparent',
                        fontFamily: typography.fontFamily.body
                      }}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <HighlightedLabel label={item.label} indices={item.matchIndices} />

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
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
