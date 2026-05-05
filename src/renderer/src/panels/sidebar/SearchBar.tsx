import { useState } from 'react'
import { borderRadius, colors, typography } from '../../design/tokens'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <div
      className="sidebar-search-shell"
      data-focused={focused ? 'true' : 'false'}
      style={{
        // Console: square hairline, inline radius, hairline border that brightens
        // to accent line on focus. Background drops to the canvas surface so the
        // input reads as a single recessed slot, not a raised pill.
        borderRadius: borderRadius.inline,
        border: `0.5px solid ${focused ? colors.accent.line : colors.border.default}`,
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
  )
}
