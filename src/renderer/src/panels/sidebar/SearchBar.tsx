import { useState } from 'react'
import { colors } from '../../design/tokens'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <div className="relative">
      {/* Search icon */}
      <svg
        width={13}
        height={13}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: focused ? colors.text.secondary : colors.text.muted,
          transition: 'color 200ms ease-out'
        }}
      >
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
      </svg>
      <input
        type="text"
        placeholder="Search..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onSearch(e.target.value)
        }}
        className="sidebar-search w-full outline-none"
        style={{
          backgroundColor: focused ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.05)',
          color: colors.text.primary,
          border: `1px solid ${focused ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.08)'}`,
          borderRadius: 6,
          padding: '6px 12px 6px 30px',
          fontSize: 13,
          transition: 'border-color 200ms ease-out, background-color 200ms ease-out'
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}
