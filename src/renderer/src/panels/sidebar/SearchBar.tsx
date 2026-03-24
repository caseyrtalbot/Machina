import { useState } from 'react'
import { colors, floatingPanel } from '../../design/tokens'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <div className="relative">
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
        placeholder="Search vault..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onSearch(e.target.value)
        }}
        className="sidebar-search w-full outline-none"
        style={{
          backgroundColor: focused ? floatingPanel.glass.inputBgFocus : floatingPanel.glass.inputBg,
          color: colors.text.primary,
          border: 'none',
          borderRadius: 8,
          padding: '8px 12px 8px 32px',
          fontSize: 12,
          transition: 'background-color 200ms ease-out'
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}
