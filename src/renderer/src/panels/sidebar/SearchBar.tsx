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
      className="w-full px-3 py-1.5 text-sm rounded outline-none"
      style={{
        backgroundColor: colors.bg.elevated,
        color: colors.text.primary,
        border: `1px solid ${colors.border.default}`
      }}
    />
  )
}
