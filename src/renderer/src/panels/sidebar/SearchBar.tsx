import { useEffect, useState } from 'react'
import { searchVault } from '../../engine/vault-search'
import { openArtifactInEditor } from '../../system-artifacts/system-artifact-runtime'
import type { SearchHit } from '@shared/engine/search-engine'

interface SearchBarProps {
  onSearch: (query: string) => void
}

const FULLTEXT_DEBOUNCE_MS = 150
const FULLTEXT_LIMIT = 8

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  // Full-text hits from the vault-worker SearchEngine. The filename filter
  // (onSearch → tree) is unchanged; these add body matches with snippets.
  const [hits, setHits] = useState<readonly SearchHit[]>([])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setHits([])
        return
      }
      void searchVault(query, FULLTEXT_LIMIT).then((results) => {
        if (!cancelled) setHits(results)
      })
    }, FULLTEXT_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const showResults = focused && query.trim().length > 0 && hits.length > 0

  return (
    <div className="te-searchbar-root">
      <div className="sidebar-search-shell" data-focused={focused ? 'true' : 'false'}>
        <span className="sidebar-search-prompt" aria-hidden="true">
          /
        </span>
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onSearch(e.target.value)
          }}
          className="sidebar-search sidebar-search-input"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      {showResults && (
        <ul role="listbox" aria-label="full-text results" className="te-searchbar-results">
          {hits.map((hit) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={false}
              className="te-searchbar-result"
              // mousedown fires before the input's blur, so the click lands
              // before the dropdown unmounts.
              onMouseDown={(e) => {
                e.preventDefault()
                openArtifactInEditor(hit.path, hit.title)
                setFocused(false)
              }}
            >
              <span className="te-searchbar-result-title">
                {hit.title}
                {hit.page !== undefined && (
                  <span className="te-searchbar-result-meta"> · p.{hit.page}</span>
                )}
                {hit.semantic === true && (
                  <span className="te-searchbar-result-meta"> · semantic</span>
                )}
              </span>
              <span className="te-searchbar-result-snippet">{hit.snippet || hit.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
