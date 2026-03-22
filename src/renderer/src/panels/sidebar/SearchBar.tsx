import { useState } from 'react'
import { colors } from '../../design/tokens'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('')

  return (
    <input
      type="text"
      placeholder="Search..."
      value={query}
      onChange={(e) => {
        setQuery(e.target.value)
        onSearch(e.target.value)
      }}
      className="sidebar-search w-full px-3 py-[7px] text-sm outline-none"
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        color: colors.text.primary,
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 8,
        transition: 'border-color 150ms ease-out, background-color 150ms ease-out'
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)'
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'
      }}
    />
  )
}
