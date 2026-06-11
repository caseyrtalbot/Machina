import { useEffect, useState } from 'react'
import { borderRadius, colors, floatingPanel, typography, zIndex } from '../../design/tokens'
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
    <div style={{ position: 'relative' }}>
      <div
        className="sidebar-search-shell"
        data-focused={focused ? 'true' : 'false'}
        style={{
          // Console: square hairline, inline radius, hairline border that brightens
          // to accent line on focus. Background drops to the canvas surface so the
          // input reads as a single recessed slot, not a raised pill.
          borderRadius: borderRadius.inline,
          border: `1px solid ${focused ? colors.accent.line : colors.border.default}`,
          background: 'transparent',
          minHeight: 28,
          padding: '6px 10px',
          gap: 8
        }}
      >
        <span
          className="sidebar-search-prompt"
          aria-hidden="true"
          style={{
            fontFamily: typography.fontFamily.mono,
            fontSize: 12,
            letterSpacing: 0,
            color: colors.text.disabled
          }}
        >
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
          style={{
            fontFamily: typography.fontFamily.mono,
            fontSize: 12,
            letterSpacing: 0,
            color: colors.text.primary
          }}
        />
      </div>
      {showResults && (
        <ul
          role="listbox"
          aria-label="full-text results"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            marginBottom: 0,
            padding: '4px 0',
            listStyle: 'none',
            maxHeight: 320,
            overflowY: 'auto',
            background: floatingPanel.glass.popoverBg,
            backdropFilter: floatingPanel.glass.popoverBlur,
            WebkitBackdropFilter: floatingPanel.glass.popoverBlur,
            border: `1px solid ${colors.border.default}`,
            borderRadius: borderRadius.inline,
            boxShadow: floatingPanel.shadowCompact,
            zIndex: zIndex.surfacePopover
          }}
        >
          {hits.map((hit) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={false}
              // mousedown fires before the input's blur, so the click lands
              // before the dropdown unmounts.
              onMouseDown={(e) => {
                e.preventDefault()
                openArtifactInEditor(hit.path, hit.title)
                setFocused(false)
              }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
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
                {hit.title}
                {hit.page !== undefined && (
                  <span style={{ color: colors.text.muted }}> · p.{hit.page}</span>
                )}
                {hit.semantic === true && (
                  <span style={{ color: colors.text.muted }}> · semantic</span>
                )}
              </span>
              <span
                style={{
                  color: colors.text.muted,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 10,
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
              >
                {hit.snippet || hit.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
