import { useEffect, useMemo, useRef, useState } from 'react'
import type { Artifact } from '@shared/types'

const MAX_RESULTS = 8

interface ConnectionAutocompleteProps {
  artifacts: readonly Artifact[]
  currentArtifactId: string
  existingConnections: readonly string[]
  onSelect: (connectionValue: string) => void
  onClose: () => void
}

interface Suggestion {
  readonly artifact: Artifact
  readonly matchScore: number
}

function score(title: string, id: string, query: string): number {
  if (query === '') return 0
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const i = id.toLowerCase()
  if (t.startsWith(q) || i.startsWith(q)) return 3
  if (t.includes(q) || i.includes(q)) return 2
  return 0
}

function filterSuggestions(
  artifacts: readonly Artifact[],
  currentArtifactId: string,
  existingConnections: readonly string[],
  query: string
): Suggestion[] {
  const excluded = new Set<string>([...existingConnections])
  const candidates: Suggestion[] = []

  for (const a of artifacts) {
    if (a.id === currentArtifactId) continue
    // Exclude by title match (storage convention) OR by id match (legacy data).
    if (excluded.has(a.title) || excluded.has(a.id)) continue

    const s = score(a.title, a.id, query)
    if (query !== '' && s === 0) continue
    candidates.push({ artifact: a, matchScore: s })
  }

  candidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
    // Tiebreak by modified desc
    return (b.artifact.modified ?? '').localeCompare(a.artifact.modified ?? '')
  })

  return candidates.slice(0, MAX_RESULTS)
}

export function ConnectionAutocomplete({
  artifacts,
  currentArtifactId,
  existingConnections,
  onSelect,
  onClose
}: ConnectionAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const suggestions = useMemo(
    () => filterSuggestions(artifacts, currentArtifactId, existingConnections, query),
    [artifacts, currentArtifactId, existingConnections, query]
  )

  // Clamp during render rather than in an effect (avoids setState-in-effect).
  // ArrowDown/ArrowUp handlers still call setHighlight; the clamp takes effect
  // on the next render when suggestions shrink below the stored highlight.
  const clampedHighlight = suggestions.length > 0 ? Math.min(highlight, suggestions.length - 1) : 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = suggestions[clampedHighlight]
      if (pick) onSelect(pick.artifact.title)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="te-connauto">
      <div className="te-connauto-inputwrap">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add connection…"
          role="combobox"
          aria-expanded={true}
          aria-controls="connection-autocomplete-listbox"
          aria-activedescendant={
            suggestions.length > 0
              ? `connection-autocomplete-option-${clampedHighlight}`
              : undefined
          }
          className="te-connauto-input"
        />
      </div>
      <div id="connection-autocomplete-listbox" className="te-connauto-list" role="listbox">
        {suggestions.length === 0 ? (
          <div className="te-connauto-empty">No matches</div>
        ) : (
          suggestions.map((s, index) => (
            <button
              key={s.artifact.id}
              id={`connection-autocomplete-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === clampedHighlight}
              onClick={() => onSelect(s.artifact.title)}
              onMouseEnter={() => setHighlight(index)}
              className="te-connauto-option"
            >
              {s.artifact.title}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
