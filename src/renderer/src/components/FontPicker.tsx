import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { colors } from '../design/tokens'
import {
  ALL_FONT_OPTIONS,
  FONT_CATEGORIES,
  buildGoogleFontUrl,
  buildFontFamilyValue,
  type FontCategory,
  type GoogleFontEntry
} from '../design/google-fonts'

interface FontPickerProps {
  value: string
  onChange: (fontName: string) => void
}

/**
 * Searchable, categorized font picker with live preview.
 * Loads fonts on hover for lightweight previewing.
 */
export function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FontCategory>('all')
  const [previewFont, setPreviewFont] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredFonts = useMemo(() => {
    const query = search.toLowerCase()
    return ALL_FONT_OPTIONS.filter((f) => {
      if (category !== 'all' && f.category !== category) return false
      if (query && !f.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [search, category])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Focus search when opened
  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus()
      // Scroll to selected font
      requestAnimationFrame(() => {
        const selected = listRef.current?.querySelector('[data-selected="true"]')
        selected?.scrollIntoView({ block: 'center' })
      })
    } else {
      // Reset state when picker closes — cascading render is acceptable here
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch('')
      setCategory('all')
    }
  }, [isOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }, [])

  // Load a font for preview on hover
  const handleHover = useCallback((font: GoogleFontEntry) => {
    setPreviewFont(font.name)
    const url = buildGoogleFontUrl(font)
    if (!url) return

    // Check if already loaded
    const linkId = `te-preview-${font.name.replace(/ /g, '-')}`
    if (document.getElementById(linkId)) return

    const link = document.createElement('link')
    link.id = linkId
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }, [])

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs px-2 py-1 rounded flex items-center gap-1.5 min-w-[140px] justify-between"
        style={{
          backgroundColor: colors.bg.elevated,
          color: colors.text.primary,
          border: `1px solid ${colors.border.default}`,
          fontFamily: buildFontFamilyValue(value)
        }}
      >
        <span className="truncate">{value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2.5 4L5 6.5L7.5 4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden shadow-xl"
          style={{
            width: 280,
            backgroundColor: colors.bg.elevated,
            border: `1px solid ${colors.border.default}`,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b" style={{ borderColor: colors.border.default }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search fonts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded outline-none"
              style={{
                backgroundColor: colors.bg.base,
                color: colors.text.primary,
                border: `1px solid ${colors.border.default}`
              }}
            />
          </div>

          {/* Category filters */}
          <div
            className="flex gap-0.5 px-2 py-1.5 border-b"
            style={{ borderColor: colors.border.default }}
          >
            {FONT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className="text-[10px] px-1.5 py-0.5 rounded capitalize transition-colors"
                style={{
                  backgroundColor: category === cat ? colors.accent.muted : 'transparent',
                  color: category === cat ? colors.accent.default : colors.text.muted
                }}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* Font list */}
          <div ref={listRef} className="max-h-[240px] overflow-y-auto">
            {filteredFonts.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center" style={{ color: colors.text.muted }}>
                No fonts match &ldquo;{search}&rdquo;
              </div>
            ) : (
              filteredFonts.map((font) => {
                const isSelected = font.name === value
                const isHovered = font.name === previewFont
                return (
                  <button
                    key={font.name}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => {
                      onChange(font.name)
                      setIsOpen(false)
                    }}
                    onMouseEnter={() => handleHover(font)}
                    onMouseLeave={() => setPreviewFont(null)}
                    className="w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors text-xs"
                    style={{
                      backgroundColor: isSelected
                        ? colors.accent.muted
                        : isHovered
                          ? colors.bg.surface
                          : 'transparent',
                      color: isSelected ? colors.accent.default : colors.text.primary,
                      fontFamily:
                        isHovered || isSelected ? buildFontFamilyValue(font.name) : undefined
                    }}
                  >
                    <span className="truncate">{font.name}</span>
                    <span
                      className="text-[10px] ml-2 flex-shrink-0"
                      style={{ color: colors.text.muted }}
                    >
                      {font.category}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer count */}
          <div
            className="px-3 py-1.5 border-t text-[10px]"
            style={{ borderColor: colors.border.default, color: colors.text.muted }}
          >
            {filteredFonts.length} font{filteredFonts.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
